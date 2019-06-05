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
import { logError, logInfo } from '../utils/logger';

const sns = new SNS();
const parse = DynamoDB.Converter.unmarshall;
const s3 = new S3({ apiVersion: '2006-03-01' });
const lambda = new Lambda({ region: 'eu-west-1' });
const docTypeMapping = ['FPN', 'IM', 'CDN'];
const portalOrigin = 'PORTAL';
const appOrigin = 'APP';
const newHashConstant = '<NewHash>';

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
	 */
	async updateMultipleUponPaymentDelete(paymentInfo) {
		const { penaltyDocumentIds } = paymentInfo;
		try {
			const updatedDocs = await this._updateDocumentsToUnpaidStatus(penaltyDocumentIds);

			if (updatedDocs.length !== 0) {
				// Only support reversal of payments within the same penalty group.
				await this._tryUpdatePenaltyGroupToUnpaidStatus(updatedDocs[0].penaltyGroupId, 'UNPAID');
			}

			return createResponse({ statusCode: HttpStatus.OK });
		} catch (err) {
			logError('UpdateMultipleUponPaymentDeleteError', {
				message: 'Error updating multiple docs upon payment delete',
				error: err.message,
				penaltyDocumentIds,
			});
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
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

		try {
			const data = await this.db.get(getParams).promise();
			if (!data.Item) {
				return await this.createDummyDocumentForPayment(paymentInfo);
			}
			await this.putDocumentWithPayment(data.Item, paymentInfo);

			return createResponse({ statusCode: HttpStatus.OK, body: data.Item });
		} catch (err) {
			logError('UpdateDocumentWithPaymentError', {
				error: err.message,
				documentId: paymentInfo.id,
				paymentToken: paymentInfo.paymentToken,
			});
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: err.message });
		}
	}

	// put
	async updateDocumentWithPaymentStartTime(documentId) {
		const updateParams = {
			TableName: this.penaltyDocTableName,
			Key: {
				ID: documentId,
			},
			UpdateExpression: 'set #Value.#paymentStartTime = :paymentStartTime',
			ConditionExpression: 'attribute_exists(#ID)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
				'#Value': 'Value',
				'#paymentStartTime': 'paymentStartTime',
			},
			ExpressionAttributeValues: {
				':paymentStartTime': new Date().valueOf() / 1000,
			},
		};
		try {
			const data = await this.db.update(updateParams).promise();
			return createResponse({ statusCode: HttpStatus.OK })
		} catch (err) {
			logError('UpdateDocumentWithPaymentStartTimeError', {
				documentId,
				error: err.message,
			});
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: err.message });
		}
	}

	async putDocumentWithPayment(penalty, paymentInfo) {
		penalty.Value.paymentStatus = paymentInfo.paymentStatus;
		penalty.Hash = hashToken(paymentInfo.id, penalty.Value, penalty.Enabled);
		penalty.Offset = getUnixTime();

		const putParams = {
			TableName: this.penaltyDocTableName,
			Item: penalty,
			ConditionExpression: 'attribute_exists(#ID)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
			},
		};

		await this.db.put(putParams).promise();

		if (penalty.Origin === appOrigin) {
			this.sendPaymentNotification(paymentInfo, penalty);
		}
	}

	async createDummyDocumentForPayment(paymentInfo) {
		const timeNow = getUnixTime();
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

		try {
			const response = await this.createDocument(dummyPenaltyDoc);
			if (response.statusCode === HttpStatus.CREATED) {
				logInfo('DummmyPenaltyDocumentCreateSuccess', {
					paymentToken: paymentInfo.paymentToken,
				});
			} else {
				logError('DummmyPenaltyDocumentCreateError', {
					message: 'Unable to create dummy penalty document',
					statusCode: response.statusCode,
					dummyPenaltyDoc,
				});
			}
		} catch (err) {
			// Log error but fail silently
			logError('DummmyPenaltyDocumentCreateError', {
				error: err.message,
				dummyPenaltyDoc
			});
		}
		return createResponse({ statusCode: HttpStatus.OK, body: dummyPenaltyDoc });
	}

	sendPaymentNotification(paymentInfo, documentInfo) {
		const params = this.paymentMessageParams(paymentInfo, documentInfo);
		sns.publish(params, (err, data) => {
			if (err) {
				logError('SendPaymentNotificationError', {
					message: 'Unable to send message.',
					error: err.message,
				});
			} else {
				logInfo('SendPaymentNotificationSuccess', {
					snsResponse: data,
					messageContents: params,
				});
			}
		});
	}

	async createDocument(body) {

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
		return this.getPaymentInformationViaInvocation(idList)
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
					logError('CreateDocValidationError', {
						validationError: err,
						penaltyDocument: body,
					});
					return validationError;
				}
				const dbPut = this.db.put(params).promise();
				return dbPut.then(() => {
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

					return createResponse({ statusCode: HttpStatus.OK, body: item });
				}).catch((err) => {
					const returnResponse = createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
					return returnResponse;
				});
			}).catch((err) => {
				const returnResponse = createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
				return returnResponse;
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
				.then(data => resolve(JSON.parse(JSON.parse(data.Payload).body)))
				.catch(err => {
					logError('GetPaymentInfoViaInvocationError', {
						idList,
						error: err.message,
					});
					reject(err);
				});
		});
	}

	// Delete
	async deleteDocument(id, body) {
		const timestamp = getUnixTime();
		let paidStatus = 'UNPAID';
		const idList = [];
		idList.push(id);

		let response;
		try {
			response = await this.getPaymentInformationViaInvocation(idList);
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
				return validationError;
			}

			const checkTest = Validation.penaltyDocumentValidation(body);
			if (!checkTest.valid) {
				const err = checkTest.error.message;
				const validationError = createResponse({
					body: {
						err,
					},
					statusCode: HttpStatus.BAD_REQUEST,
				});
				return validationError;
			}

			return this.disableDocument(id, body, timestamp);
		} catch (err) {
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
		}
	}

	async disableDocument(id, body, timestamp) {
		const Enabled = false;
		const { Value } = body;

		const clientHash = body.Hash;
		const newHash = hashToken(id, Value, Enabled);

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

		try {
			await this.db.update(params).promise();
			return createResponse({ statusCode: HttpStatus.OK, body: deletedItem });
		} catch (err) {
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
		}
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
			logError('GetDocumentByTokenError', {
				error: error.message,
				token,
			});
			return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: error });
		}


		if (data.Payload) {
			try {
				const parsedPayload = JSON.parse(data.Payload);
				if (parsedPayload.statusCode === HttpStatus.BAD_REQUEST) {
					const payloadBody = JSON.parse(parsedPayload.body);
					logError('GetDocumentTokenServiceResponseError', {
						message: 'Token service returned bad request (status 400)',
						payloadBody,
						paymentCode: token,
					});
					return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: { name: 'Token Error', message: payloadBody.message } });
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
					const errMessage = {
						name: 'Error from GetDocument',
						message: 'The GetDocument method returned an unhandled error',
					};
					logError('GetDocumentByTokenError', {
						...errMessage,
						docID,
						docStatusCode: res.statusCode,
					});
					return createErrorResponse({
						statusCode: HttpStatus.BAD_REQUEST,
						err: errMessage,
					});
				});
			} catch (e) {
				logError('GetDocumentByTokenError', {
					error: e.message,
					payload: data.Payload,
				});
				return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err: e.message });
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
		const clientHash = item.Hash ? item.Hash : newHashConstant;
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
			// Update if not exists, portal origin, app origin with matching hash (from app db), or if no hash from app but existing token is cancelled.
			ConditionExpression: 'attribute_not_exists(#ID) OR (#Origin = :PortalOrigin  and attribute_exists(#ID)) OR (#Origin = :AppOrigin and attribute_exists(#ID) AND #Hash=:clientHash) OR (#Origin = :AppOrigin and attribute_exists(#ID) AND :isNewHash AND #Enabled = :notEnabled)',
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
				':notEnabled': false,
				':isNewHash': clientHash === newHashConstant,
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
					const nonExistingOrPortalOrigin = data.Attributes === undefined
						|| data.Attributes.Origin === portalOrigin;
					if (nonExistingOrPortalOrigin && item.Origin === appOrigin && savedPaymentStatus === 'PAID') {
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
					const responseBody = {
						statusCode: HttpStatus.BAD_REQUEST,
						body: updatedItem,
						error: err,
					};

					logError('UpdateItemError', {
						responseBody,
						params
					});

					resolve(createSimpleResponse(responseBody));
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

	async updateDocuments(items) {
		//  let items = JSON.parse(event.body).Items;
		const idList = [];
		items.forEach((item) => {
			idList.push(item.ID);
			delete item.Value.paymentStatus;
			delete item.Value.paymentAuthCode;
			delete item.Value.paymentDate;
			delete item.Value.paymentRef;
		});

		return this.getPaymentInformationViaInvocation(idList)
			.then((response) => {
				let mergedList = [];
				mergedList = mergeDocumentsWithPayments({ items, payments: response.payments });
				return this.asyncLoopOrdered(this, this.updateItem, mergedList).then((outputValue) => {
					const result = {
						Items: outputValue,
					};
					return createResponse({ statusCode: HttpStatus.OK, body: result });
				}).catch((err) => {
					logError('UpdateDocumentsAsyncUpdateItemError', {
						mergedList,
						error: err.message,
					});
					return createResponse({ statusCode: HttpStatus.BAD_REQUEST, body: err });
				});
			})
			.catch((err) => {
				return createErrorResponse({ statusCode: HttpStatus.BAD_REQUEST, err });
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
			const snsResponse = await this.sendSnsMessage(params);
			logInfo('StreamDocumentsSendMessageSuccess', {
				snsResponse,
			});
			return `Successfully processed ${event.Records.length} records.`;
		} catch (err) {
			logError('StreamDocumentsSendMessageError', {
				error: err.message,
				snsMessageParams: params,
			});
			return `Unable to send message. Error JSON: ${JSON.stringify(err.message, null, 2)}`;
		}
	}

	sendSnsMessage(params) {
		return sns.publish(params).promise();
	}
}
