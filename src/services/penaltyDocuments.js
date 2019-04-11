/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import { SNS, S3, Lambda, DynamoDB } from 'aws-sdk';
import Validation from 'rsp-validation';
import config from '../config';
import hashToken from '../utils/hash';
import getUnixTime from '../utils/time';
import createResponse from '../utils/createResponse';
import createSimpleResponse from '../utils/createSimpleResponse';
import createErrorResponse from '../utils/createErrorResponse';
import createStringResponse from '../utils/createStringResponse';
import mergeDocumentsWithPayments from '../utils/mergeDocumentsWithPayments';
import formatMinimalDocument from '../utils/formatMinimalDocument';
import subtractDays from '../utils/subtractDays';
import HttpStatus from '../utils/httpStatusCode';

const sns = new SNS();
const parse = DynamoDB.Converter.unmarshall;
const s3 = new S3({ apiVersion: '2006-03-01' });
const lambda = new Lambda({ region: 'eu-west-1' });
const docTypeMapping = ['FPN', 'IM', 'CDN'];
const portalOrigin = 'PORTAL';
const appOrigin = 'APP';

export default class PenaltyDocument {

	/**
	 * Instantiate the penalty document service.
	 * @param {AWS.DynamoDB.DocumentClient} db Dynamodb interface for penalty documents.
	 * @param {string} penaltyDocTableName Table name of penalty documents.
	 * @param {string} bucketName S3 bucket name where RSP DVSA sites are stored.
	 * @param {string} snsTopicARN ARN for payment notification SNS service.
	 * @param {string} siteResource Resource file path for sites within the bucket
	 * specified with `bucketName`
	 * @param {string} paymentURL URL of payment service.
	 * @param {string} tokenServiceARN ARN of token service.
	 * @param {number} daysToHold Number of days to keep penalty documents.
	 * @param {string} paymentsBatchFetchArn The payment service batch fetch ARN.
	 */
	constructor(
		db,	penaltyDocTableName, bucketName,
		snsTopicARN, siteResource, paymentURL,
		tokenServiceARN, daysToHold, paymentsBatchFetchArn,
	) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.bucketName = bucketName;
		this.snsTopicARN = snsTopicARN;
		this.siteResource = siteResource;
		this.paymentURL = paymentURL;
		this.tokenServiceARN = tokenServiceARN;
		this.daysToHold = daysToHold;
		this.paymentsBatchFetchArn = paymentsBatchFetchArn;
		this.maxBatchSize = config.dynamodbMaxBatchSize();
	}

	async getDocument(id) {
		const params = {
			TableName: this.penaltyDocTableName,
			Key: {
				ID: id,
			},
		};

		const dbGet = this.db.get(params).promise();

		return dbGet.then((data) => {
			if (!data.Item || this.isEmpty(data)) {
				return createResponse({ statusCode: 404, body: { error: 'ITEM NOT FOUND' } });
			}
			const idList = [];
			idList.push(id);
			delete data.Item.Origin;
			return this.getPaymentInformationViaInvocation(idList)
				.then((response) => {
					if (response.payments !== null && typeof response.payments !== 'undefined' && response.payments.length > 0) {
						data.Item.Value.paymentStatus = response.payments[0].PenaltyStatus;
						data.Item.Value.paymentAuthCode = response.payments[0].PaymentDetail.AuthCode;
						data.Item.Value.paymentDate = Number(response.payments[0].PaymentDetail.PaymentDate);
						data.Item.Value.paymentRef = response.payments[0].PaymentDetail.PaymentRef;
						data.Item.Value.paymentMethod = response.payments[0].PaymentDetail.PaymentMethod;
					} else {
						data.Item.Value.paymentStatus = 'UNPAID';
					}
					return createResponse({ statusCode: HttpStatus.OK, body: data.Item });
				}).catch((err) => {
					return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
				});
		}).catch((err) => {
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
		});
	}

	isEmpty(obj) {
		return JSON.stringify(obj) === JSON.stringify({});
	}

	async updateDocumentUponPaymentDelete(paymentInfo) {
		const getParams = {
			TableName: this.penaltyDocTableName,
			Key: {
				ID: paymentInfo.id,
			},
		};
		const dbGet = this.db.get(getParams).promise();

		try {
			const data = await dbGet;
			data.Item.Value.paymentStatus = paymentInfo.paymentStatus;
			data.Item.Hash = hashToken(paymentInfo.id, data.Item.Value, data.Item.Enabled);
			data.Item.Offset = getUnixTime();
			const putParams = {
				TableName: this.penaltyDocTableName,
				Item: data.Item,
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: {
					'#ID': 'ID',
				},
			};

			const dbPut = this.db.put(putParams).promise();
			return dbPut.then(() => {
				return createResponse({ statusCode: HttpStatus.OK, body: data.Item });
			}).catch((err) => {
				return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: { message: err } });
			});
		} catch (err) {
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: { message: err } });
		}
	}

	/**
	 * Update the penalty document and its parent group with paymentInfo.
	 * @param {{penaltyDocumentIds: Array<string>}} paymentInfo The new
	 * payment info. (e.g. {penaltyDocuments: [890700000823_FPN, 912900000182_IM]}).
	 * @param {(_, response) => void} callback Callback returning a status code
	 * and the new document or an error.
	 */
	async updateMultipleUponPaymentDelete(paymentInfo, callback) {
		try {
			const updatedDocs = await this._updateDocumentsToUnpaidStatus(paymentInfo.penaltyDocumentIds);

			if (updatedDocs.length !== 0) {
				// Only support reversal of payments within the same penalty group.
				await this._tryUpdatePenaltyGroupToUnpaidStatus(updatedDocs[0].penaltyGroupId, 'UNPAID');
			}

			callback(null, createResponse({ statusCode: HttpStatus.OK }));
		} catch (err) {
			console.log(`Error updating multiple docs upon payment delete ${err}`);
			callback(null, createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err }));
		}
	}

	/**
	 * Update docs
	 * @param {Array<string>} penaltyDocumentIds
	 * @returns {Promise<Array<any>>} The group penalty document group ids.
	 */
	async _updateDocumentsToUnpaidStatus(penaltyDocumentIds) {
		const penaltyDocumentRequests = penaltyDocumentIds.map((penaltyDocumentId) => {
			const getParams = {
				TableName: this.penaltyDocTableName,
				Key: {
					ID: penaltyDocumentId,
				},
			};
			return this.db.get(getParams).promise();
		});

		const penaltyDocuments = (await Promise.all(penaltyDocumentRequests)).map(doc => doc.Item);

		const putRequests = penaltyDocuments.map((penaltyDocument) => {
			return this._tryUpdatePenaltyDocToUnpaidStatus(penaltyDocument);
		});

		await Promise.all(putRequests);

		return penaltyDocuments;
	}

	/**
	 * Update each penaltyDocument to be unpaid if it's not already.
	 * Also update offset and hash.
	 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} penaltyDocument The penalty document
	 * to be updated.
	 */
	_tryUpdatePenaltyDocToUnpaidStatus(penaltyDocument) {
		penaltyDocument.Value.paymentStatus = 'UNPAID';
		penaltyDocument.Hash = hashToken(
			penaltyDocument.ID,
			penaltyDocument.Value,
			penaltyDocument.Enabled,
		);
		penaltyDocument.Offset = getUnixTime();
		const docPutParams = {
			TableName: this.penaltyDocTableName,
			Item: penaltyDocument,
			ConditionExpression: 'attribute_exists(#ID)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
			},
		};

		return this.db.put(docPutParams).promise();
	}

	/**
	 * Sets the group status to UNPAID and updates its timestamp if currently set to PAID.
	 * @param {string} penaltyGroupId The penalty group id to update.
	 * @param {string} paymentStatus The new payment status. If set to anything other than 'UNPAID',
	 * the method will resolve immediately.
	 */
	async _tryUpdatePenaltyGroupToUnpaidStatus(penaltyGroupId, paymentStatus) {
		const penaltyGroupTable = config.dynamodbPenaltyGroupTable();
		const getGroupParams = {
			TableName: penaltyGroupTable,
			Key: { ID: penaltyGroupId },
		};
		const penaltyGroupContainer = await this.db.get(getGroupParams).promise();
		const penaltyGroup = penaltyGroupContainer.Item;
		if (penaltyGroup.PaymentStatus !== paymentStatus) {
			penaltyGroup.PaymentStatus = paymentStatus;
			penaltyGroup.Offset = getUnixTime();
			const putGroupParams = {
				TableName: penaltyGroupTable,
				Item: penaltyGroup,
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: {
					'#ID': 'ID',
				},
			};
			return this.db.put(putGroupParams).promise();
		}
		return Promise.resolve();
	}

	// put
	async updateDocumentWithPayment(paymentInfo) {
		const getParams = {
			TableName: this.penaltyDocTableName,
			Key: {
				ID: paymentInfo.id,
			},
		};
		const dbGet = this.db.get(getParams).promise();
		const timeNow = getUnixTime();

		return dbGet.then((data) => {
			if (!data.Item) {
				let referenceNo = paymentInfo.penaltyRefNo;
				if (paymentInfo.penaltyType === 'IM') {
					referenceNo = `${referenceNo.slice(0, 6)}-${referenceNo[7]}-${referenceNo.slice(8, 13)}-IM`;
				}
				const dummyPenaltyDoc = {
					ID: paymentInfo.id,
					Value: {
						dateTime: timeNow,
						siteCode: 5,
						vehicleDetails: {
							regNo: 'UNKNOWN',
						},
						referenceNo,
						penaltyType: paymentInfo.penaltyType,
						paymentToken: paymentInfo.paymentToken,
						officerName: 'UNKNOWN',
						penaltyAmount: Number(paymentInfo.paymentAmount),
						officerID: 'UNKNOWN',
						inPenaltyGroup: false,
						paymentStatus: paymentInfo.paymentStatus,
					},
					Enabled: true,
					Origin: portalOrigin,
				};
				dummyPenaltyDoc.Hash = 'New';
				// hashToken(paymentInfo.id, dummyPenaltyDoc.Value, dummyPenaltyDoc.Enabled);
				dummyPenaltyDoc.Offset = timeNow;
				// Create the penalty document but don't mark as paid
				return new Promise((resolve, reject) => {
					this.createDocument(dummyPenaltyDoc, (error, response) => {
						if (error) {
							reject(error);
						} else {
							resolve(response);
						}
					});
				}).then((response) => {
					if (response.statusCode !== HttpStatus.CREATED) {
						console.error('Unable to create dummy penalty document');
					}
					return createResponse({ statusCode: HttpStatus.OK, body: dummyPenaltyDoc });
				}).catch(() => {
					return createResponse({ statusCode: HttpStatus.OK, body: dummyPenaltyDoc });
				});
			}

			data.Item.Value.paymentStatus = paymentInfo.paymentStatus;
			data.Item.Hash = hashToken(paymentInfo.id, data.Item.Value, data.Item.Enabled);
			data.Item.Offset = getUnixTime();

			const putParams = {
				TableName: this.penaltyDocTableName,
				Item: data.Item,
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: {
					'#ID': 'ID',
				},
			};

			const dbPut = this.db.put(putParams).promise();
			return dbPut.then(() => {
				console.error(data);
				if (data.Item.Origin === appOrigin) {
					this.sendPaymentNotification(paymentInfo, data.Item);
				}
				return createResponse({ statusCode: HttpStatus.OK, body: data.Item });
			}).catch((err) => {
				const returnResponse = createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
				return returnResponse;
			});
		}).catch((err) => {
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
		});
	}

	sendPaymentNotification(paymentInfo, documentInfo) {
		const params = this.paymentMessageParams(paymentInfo, documentInfo);
		sns.publish(params, (err, data) => {
			if (err) {
				console.log('Unable to send message. Error JSON:', JSON.stringify(err, null, 2));
			} else {
				console.log('Results from sending message: ', JSON.stringify(data, null, 2));
			}
		});
	}

	createDocument(body, callback) {

		delete body.Value.paymentStatus;
		delete body.paymentAuthCode;
		delete body.paymentDate;
		delete body.paymentRef;

		const timestamp = getUnixTime();
		const { Value, Enabled, ID } = body;
		const idList = [];
		// remove payment info, payment service is single point truth
		// may not need to remove this delete Value.paymentToken;
		if (typeof body.Origin === 'undefined') {
			body.Origin = appOrigin;
		}

		const item = {
			ID,
			Value,
			Enabled,
			Origin: body.Origin,
			Hash: hashToken(ID, Value, Enabled),
			Offset: timestamp,
			VehicleRegistration: Value.vehicleDetails.regNo,
		};

		idList.push(ID);
		this.getPaymentInformationViaInvocation(idList)
			.then((response) => {
				const params = {
					TableName: this.penaltyDocTableName,
					Item: item,
					ConditionExpression: 'attribute_not_exists(#ID)',
					ExpressionAttributeNames: {
						'#ID': 'ID',
					},
				};

				const checkTest = Validation.penaltyDocumentValidation(body);
				if (!checkTest.valid) {
					const err = checkTest.error.message;
					const validationError = createResponse({
						body: {
							err,
						},
						statusCode: HttpStatus.BAD_REQUEST,
					});
					callback(null, validationError);
				} else {
					const dbPut = this.db.put(params).promise();
					dbPut.then(() => {
						// stamp payment info if we have it
						if (response.payments !== null && typeof response.payments !== 'undefined' && response.payments.length > 0) {
							item.Value.paymentStatus = response.payments[0].PenaltyStatus;
							item.Value.paymentAuthCode = response.payments[0].PaymentDetail.AuthCode;
							item.Value.paymentDate = Number(response.payments[0].PaymentDetail.PaymentDate);
							item.Value.paymentRef = response.payments[0].PaymentDetail.PaymentRef;
							// item.Hash = hashToken(ID, item.Value, Enabled); // recalc hash if payment found
						} else {
							item.Value.paymentStatus = 'UNPAID';
						}

						callback(null, createResponse({ statusCode: HttpStatus.OK, body: item }));
					}).catch((err) => {
						const returnResponse = createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
						callback(null, returnResponse);
					});
				}
			}).catch((err) => {
				const returnResponse = createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
				callback(null, returnResponse);
			});
	}

	getPaymentInformationViaInvocation(idList) {
		return new Promise((resolve, reject) => {
			const arn = this.paymentsBatchFetchArn;
			const body = JSON.stringify({
				ids: idList,
			});
			const payload = { body };
			const payloadStr = JSON.stringify(payload);
			lambda.invoke({
				FunctionName: arn,
				Payload: payloadStr,
			})
				.promise()
				// @ts-ignore
				.then(data => resolve(JSON.parse(JSON.parse(data.Payload).body)))
				.catch(err => reject(err));
		});
	}

	// Delete
	deleteDocument(id, body, callback) {
		const timestamp = getUnixTime();
		const clientHash = body.Hash;
		const Enabled = false;
		const { Value } = body;
		// may not need to remove this delete Value.paymentToken;
		const newHash = hashToken(id, Value, Enabled);
		let paidStatus = 'UNPAID';
		const idList = [];
		idList.push(id);
		this.getPaymentInformationViaInvocation(idList)
			.then((response) => {
				if (response.payments !== null && typeof response.payments !== 'undefined' && response.payments.length > 0) {
					paidStatus = response.payments[0].PenaltyStatus;
				}

				if (paidStatus === 'PAID') {
					const err = 'Cannot remove document that is paid';
					const validationError = createResponse({
						body: {
							err,
						},
						statusCode: HttpStatus.BAD_REQUEST,
					});
					callback(null, validationError);
				} else {

					const params = {
						TableName: this.penaltyDocTableName,
						Key: {
							ID: id,
						},
						UpdateExpression: 'set #Enabled = :not_enabled, #Hash = :Hash, #Offset = :Offset',
						ConditionExpression: 'attribute_exists(#ID) AND #Hash=:clientHash AND #Enabled = :Enabled',
						ExpressionAttributeNames: {
							'#ID': 'ID',
							'#Hash': 'Hash',
							'#Enabled': 'Enabled',
							'#Offset': 'Offset',
						},
						ExpressionAttributeValues: {
							':clientHash': clientHash,
							':Enabled': true,
							':Hash': newHash,
							':not_enabled': false,
							':Offset': timestamp,
						},
					};

					const deletedItem = {
						Enabled,
						ID: id,
						Offset: timestamp,
						Hash: newHash,
						Value,
					};

					const checkTest = Validation.penaltyDocumentValidation(body);
					if (!checkTest.valid) {
						const err = checkTest.error.message;
						const validationError = createResponse({
							body: {
								err,
							},
							statusCode: HttpStatus.BAD_REQUEST,
						});
						callback(null, validationError);
					} else {
						const dbUpdate = this.db.update(params).promise();

						dbUpdate.then(() => {
							callback(null, createResponse({ statusCode: HttpStatus.OK, body: deletedItem }));
						}).catch((err) => {
							const errResponse = createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
							callback(null, errResponse);
						});
					}
				}
			}).catch((err) => {
				callback(null, createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err }));
			});
	}

	/**
	 * @param {number} offset
	 * @param {string} exclusiveStartKey
	 */
	async getDocuments(offset, exclusiveStartKey) {
		const params = {
			TableName: this.penaltyDocTableName,
			IndexName: 'ByOffset',
			Limit: this.maxBatchSize,
		};
		let localOffset = offset;
		const date = new Date();

		if (typeof offset === 'undefined' || Number(offset) === 0) {
			localOffset = subtractDays(date, this.daysToHold);
		}

		if (typeof offset !== 'undefined') {
			params.KeyConditionExpression = 'Origin = :Origin and #Offset >= :Offset';
			// params.FilterExpression = '#Offset >= :Offset';
			params.ExpressionAttributeNames = { '#Offset': 'Offset' };
			params.ExpressionAttributeValues = { ':Offset': Number(localOffset), ':Origin': appOrigin };
			// could use ScanIndexForward of false to return in most recent order...
		}

		if (exclusiveStartKey !== 'undefined') {
			params.ExclusiveStartKey = exclusiveStartKey;
		}

		const idList = [];
		let data;

		try {
			data = await this.db.query(params).promise();
		} catch (err) {
			return createErrorResponse({ statusCode: 400, err });
		}

		const items = data.Items;

		if (data.Count > 0) {
			items.forEach((item) => {
				idList.push(item.ID);
				delete item.Value.paymentStatus;
				delete item.Value.paymentAuthCode;
				delete item.Value.paymentDate;
				delete item.Value.paymentRef;
				delete item.Value.paymentMethod;
				delete item.Origin; // remove Origin as not needed in response
			});

			try {
				const response = await this.getPaymentInformationViaInvocation(idList);
				let mergedList = [];
				mergedList = mergeDocumentsWithPayments({ items, payments: response.payments });
				return createResponse({
					statusCode: 200,
					body: { LastEvaluatedKey: data.LastEvaluatedKey, Items: mergedList },
				});
			} catch (err) {
				return createErrorResponse({ statusCode: 400, err });
			}
		} else {
			// no records found in scan so return empty
			return createResponse({
				statusCode: 200,
				body: { Items: [] },
			});
		}
	}

	invokeTokenServiceLambda(token) {
		return lambda.invoke({
			FunctionName: this.tokenServiceARN,
			Payload: `{"body": { "Token": "${token}" } }`,
		}).promise();
	}

	async getDocumentByToken(token) {
		let data;
		try {
			data = await this.invokeTokenServiceLambda(token);
		} catch (error) {
			console.log('Token service returned an error');
			console.log(error.message);
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: error });
		}


		if (data.Payload) {
			try {
				const parsedPayload = JSON.parse(data.Payload);
				if (parsedPayload.statusCode === HttpStatus.BAD_REQUEST) {
					console.log(`Token service returned bad request (status ${HttpStatus.BAD_REQUEST})`);
					const parsedBody = JSON.parse(parsedPayload.body);
					return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: { name: 'Token Error', message: parsedBody.message } });
				}

				const parsedBody = JSON.parse(parsedPayload.body);
				const docType = docTypeMapping[parsedBody.DocumentType];
				const docID = `${parsedBody.Reference}_${docType}`;
				return this.getDocument(docID).then((res) => {
					if (res.statusCode === HttpStatus.NOT_FOUND) {
						return this.getPaymentInformationViaInvocation([docID])
							.then((response) => {
								const paymentInfo = {};
								if (response.payments !== null && typeof response.payments !== 'undefined' && response.payments.length > 0) {
									paymentInfo.paymentStatus = response.payments[0].PenaltyStatus;
									paymentInfo.paymentAuthCode = response.payments[0].PaymentDetail.AuthCode;
									paymentInfo.paymentDate =
										Number(response.payments[0].PaymentDetail.PaymentDate);
									paymentInfo.paymentMethod =
									response.payments[0].PaymentDetail.PaymentMethod;
								} else {
									paymentInfo.paymentStatus = 'UNPAID';
								}

								const minimalDocument = formatMinimalDocument(
									parsedBody,
									docID,
									token,
									docType,
									paymentInfo,
								);

								return createResponse({
									statusCode: HttpStatus.OK,
									body: minimalDocument,
								});
							})
							.catch((e) => {
								console.log(`Error getting payment info: ${e}`);
								return createErrorResponse({
									statusCode: HttpStatus.BAD_REQUEST,
									err: e,
								});
							});
					} else if (res.statusCode === HttpStatus.OK) {
						return createResponse({
							statusCode: HttpStatus.OK,
							body: JSON.parse(res.body),
						});
					}
					return createErrorResponse({
						statusCode: HttpStatus.BAD_REQUEST,
						err: {
							name: 'Error from GetDocument',
							message: 'The GetDocument method returned an unhandled error',
						},
					});
				});
			} catch (e) {
				console.error(e);
				return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: e });
			}
		}
		return createErrorResponse({
			statusCode: HttpStatus.BAD_REQUEST,
			err: {
				name: 'No data returned from Token Service',
				message: 'The token service returned no data, it is likely there was some issue decoding the provided token',
			},
		});
	}

	// Update list

	updateItem(item) {
		const timestamp = getUnixTime();
		const key = item.ID;
		const clientHash = item.Hash ? item.Hash : '<NewHash>';
		const { Value, Enabled } = item;

		// save values before removing them on insert
		// then add back after insert. temporary measure
		// to avoid refactoring until proving integration with payment service works
		const savedPaymentStatus = ` ${item.Value.paymentStatus}`.slice(1) || 'UNPAID';
		let savedPaymentAuthCode;
		let savedPaymentDate;
		if (item.Value.paymentStatus === 'PAID') {
			savedPaymentAuthCode = ` ${item.Value.paymentAuthCode}`.slice(1);
			savedPaymentDate = Number(` ${item.Value.paymentDate}`.slice(1));
		}

		delete item.Value.paymentStatus;
		delete item.Value.paymentAuthCode;
		delete item.Value.paymentDate;
		delete item.Value.paymentRef;
		delete item.Value.paymentMethod;

		if (typeof item.Origin === 'undefined') {
			item.Origin = appOrigin;
		}
		const newHash = hashToken(key, Value, Enabled);

		const updatedItem = {
			Enabled,
			ID: key,
			Origin: item.Origin,
			Offset: timestamp,
			Hash: newHash,
			Value,
			VehicleRegistration: Value.vehicleDetails.regNo,
		};
		const params = {
			TableName: this.penaltyDocTableName,
			Key: {
				ID: key,
			},
			UpdateExpression: 'set #Value = :Value, #Hash = :Hash, #Offset = :Offset, #Enabled = :Enabled, #Origin = :Origin, #VehicleRegistration = :VehicleRegistration',
			ConditionExpression: 'attribute_not_exists(#ID) OR (#Origin = :PortalOrigin  and attribute_exists(#ID)) OR (#Origin = :AppOrigin and attribute_exists(#ID) AND #Hash=:clientHash)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
				'#Hash': 'Hash',
				'#Enabled': 'Enabled',
				'#Value': 'Value',
				'#Offset': 'Offset',
				'#Origin': 'Origin',
				'#VehicleRegistration': 'VehicleRegistration',
			},
			ExpressionAttributeValues: {
				':clientHash': clientHash,
				':Enabled': Enabled,
				':Value': Value,
				':Hash': newHash,
				':Offset': timestamp,
				':Origin': item.Origin,
				':AppOrigin': appOrigin,
				':PortalOrigin': portalOrigin,
				':VehicleRegistration': updatedItem.VehicleRegistration,
			},
			ReturnValues: 'UPDATED_OLD',
		};

		return new Promise((resolve) => {
			const res = Validation.penaltyDocumentValidation(item);
			if (res.valid) {
				const dbUpdate = this.db.update(params).promise();
				dbUpdate.then((data) => {
					updatedItem.Value.paymentStatus = savedPaymentStatus;
					if (savedPaymentStatus === 'PAID') {
						updatedItem.Value.paymentAuthCode = savedPaymentAuthCode;
						updatedItem.Value.paymentDate = savedPaymentDate;
					}
					if (data.Attributes.Origin === portalOrigin && item.Origin === appOrigin && savedPaymentStatus === 'PAID') {
						const paymentInfo = {
							penaltyType: item.Value.penaltyType,
							paymentStatus: savedPaymentStatus,
							paymentAmount: item.Value.penaltyAmount,
						};
						if (paymentInfo) {
							this.sendPaymentNotification(paymentInfo, item);
						}
					}
					resolve(createSimpleResponse({ statusCode: HttpStatus.OK, body: updatedItem }));
				}).catch((err) => {
					updatedItem.Value.paymentStatus = 'UNPAID';
					resolve(createSimpleResponse({
						statusCode: HttpStatus.BAD_REQUEST,
						body: updatedItem,
						error: err,
					}));
				});
			} else {
				resolve(createSimpleResponse({
					statusCode: HttpStatus.BAD_REQUEST,
					body: updatedItem,
					error: res.error.message,
				}));
			}
		});
	}

	asyncLoopOrdered(instance, itemOperation, items) {
		const iterations = [];
		for (let i = 0; i < items.length; i += 1) {
			iterations.push(itemOperation.call(instance, items[i]));
		}
		return Promise.all(iterations);
	}

	updateDocuments(items, context, callback) {
		//  let items = JSON.parse(event.body).Items;
		const idList = [];
		items.forEach((item) => {
			idList.push(item.ID);
			delete item.Value.paymentStatus;
			delete item.Value.paymentAuthCode;
			delete item.Value.paymentDate;
			delete item.Value.paymentRef;
		});

		this.getPaymentInformationViaInvocation(idList)
			.then((response) => {
				let mergedList = [];
				mergedList = mergeDocumentsWithPayments({ items, payments: response.payments });
				this.asyncLoopOrdered(this, this.updateItem, mergedList).then((outputValue) => {
					const result = {
						Items: outputValue,
					};
					callback(null, createResponse({ statusCode: HttpStatus.OK, body: result }));
				}).catch((err) => {
					console.log(`error updating documents in async loop: ${err}`);
					callback(null, createResponse({ statusCode: HttpStatus.BAD_REQUEST, body: err }));
				});
			})
			.catch((err) => {
				console.log(`error updating documents in outer loop: ${err}`);
				callback(null, createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err }));
			});
	}

	paymentMessageParams(paymentInfo, documentInfo) {
		const text = 'Payment has been made!';
		const aps = {
			'content-available': 1,
		};

		const message = {
			default: text,
			APNS: JSON.stringify({
				aps,
				site: documentInfo.Value.siteCode,
				offset: documentInfo.Offset,
				refNo: documentInfo.Value.referenceNo,
				regNo: documentInfo.Value.vehicleDetails.regNo,
				type: paymentInfo.penaltyType,
				status: paymentInfo.paymentStatus,
				amount: Number(paymentInfo.paymentAmount),
			}),
			APNS_SANDBOX: JSON.stringify({
				aps,
				offset: documentInfo.Offset,
				site: documentInfo.Value.siteCode,
				refNo: documentInfo.Value.referenceNo,
				regNo: documentInfo.Value.vehicleDetails.regNo,
				type: paymentInfo.penaltyType,
				status: paymentInfo.paymentStatus,
				amount: Number(paymentInfo.paymentAmount),
			}),
		};
		const params = {
			Subject: text,
			Message: JSON.stringify(message),
			TopicArn: this.snsTopicARN,
			MessageStructure: 'json',
		};
		return params;
	}

	apnsMessageParams(offset) {

		const text = 'New documents are available!';
		const site = 0;

		const aps = {
			'content-available': 1,
		};

		const message = {
			default: text,
			APNS: JSON.stringify({
				aps,
				offset,
				site,
			}),

			APNS_SANDBOX: JSON.stringify({
				aps,
				offset,
				site,
			}),
		};

		const params = {
			Subject: text,
			Message: JSON.stringify(message),
			TopicArn: this.snsTopicARN,
			MessageStructure: 'json',
		};
		return params;
	}

	async getSites() {
		const params = { Bucket: this.bucketName, Key: this.siteResource };
		try {
			const data = await s3.getObject(params).promise();
			return createStringResponse({ statusCode: HttpStatus.OK, body: data.Body.toString('utf-8') });
		} catch (err) {
			return createResponse({ statusCode: HttpStatus.BAD_REQUEST, body: err });
		}
	}

	async streamDocuments(event) {
		let minOffset = 9999999999.999;

		event.Records.forEach((record) => {
			const item = parse(record.dynamodb.NewImage);
			if (item.Offset < minOffset) {
				minOffset = item.Offset;
			}
		});

		const params = this.apnsMessageParams(minOffset);

		try {
			await this.sendSnsMessage(params);
			console.log('Results from sending message: ', JSON.stringify(params, null, 2));
			return `Successfully processed ${event.Records.length} records.`;
		} catch (err) {
			return `Unable to send message. Error JSON: ${JSON.stringify(err, null, 2)}`;
		}
	}

	sendSnsMessage(params) {
		return sns.publish(params).promise();
	}
}
