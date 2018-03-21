/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import AWS from 'aws-sdk';
import Validation from 'rsp-validation';
import request from 'request-promise';
import hashToken from '../utils/hash';
import getUnixTime from '../utils/time';
import createResponse from '../utils/createResponse';
import createSimpleResponse from '../utils/createSimpleResponse';
import createErrorResponse from '../utils/createErrorResponse';
import createStringResponse from '../utils/createStringResponse';
import mergeDocumentsWithPayments from '../utils/mergeDocumentsWithPayments';
import formatMinimalDocument from '../utils/formatMinimalDocument';
import subtractDays from '../utils/subtractDays';

const parse = AWS.DynamoDB.Converter.unmarshall;
const sns = new AWS.SNS();
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
const lambda = new AWS.Lambda({ region: 'eu-west-1' });
const docTypeMapping = ['FPN', 'IM', 'CDN'];

const maxBatchSize = 75;

export default class PenaltyDocument {

	constructor(
		db,	tableName, bucketName,
		snsTopicARN, siteResource, paymentURL,
		tokenServiceARN, daysToHold,
	) {
		this.db = db;
		this.tableName = tableName;
		this.bucketName = bucketName;
		this.snsTopicARN = snsTopicARN;
		this.siteResource = siteResource;
		this.paymentURL = paymentURL;
		this.tokenServiceARN = tokenServiceARN;
		this.daysToHold = daysToHold;
	}

	getDocument(id, callback) {
		const params = {
			TableName: this.tableName,
			Key: {
				ID: id,
			},
		};

		const dbGet = this.db.get(params).promise();

		dbGet.then((data) => {
			if (!data.Item || this.isEmpty(data)) {
				callback(null, createResponse({ statusCode: 404, body: { error: 'ITEM NOT FOUND' } }));
				return;
			}
			const idList = [];
			idList.push(id);
			delete data.Item.Origin;
			this.getPaymentInformation(idList)
				.then((response) => {
					if (response.payments !== null && typeof response.payments !== 'undefined' && response.payments.length > 0) {
						data.Item.Value.paymentStatus = response.payments[0].PenaltyStatus;
						data.Item.Value.paymentAuthCode = response.payments[0].PaymentDetail.AuthCode;
						data.Item.Value.paymentDate = response.payments[0].PaymentDetail.PaymentDate;
					} else {
						data.Item.Value.paymentStatus = 'UNPAID';
					}
					callback(null, createResponse({ statusCode: 200, body: data.Item }));
				}).catch((err) => {
					callback(null, createErrorResponse({ statusCode: 400, body: err }));
				});
		}).catch((err) => {
			callback(null, createErrorResponse({ statusCode: 400, body: err }));
		});
	}

	isEmpty(obj) {
		return JSON.stringify(obj) === JSON.stringify({});
	}

	// put
	updateDocumentWithPayment(paymentInfo, callback) {
		const getParams = {
			TableName: this.tableName,
			Key: {
				ID: paymentInfo.id,
			},
		};
		const dbGet = this.db.get(getParams).promise();

		dbGet.then((data) => {
			if (!data.Item) {
				callback(null, createResponse(404, 'ITEM NOT FOUND'));
				return;
			}

			data.Item.Value.paymentStatus = paymentInfo.paymentStatus;
			data.Item.Hash = hashToken(paymentInfo.id, data.Item.Value, data.Item.Enabled);
			data.Item.Offset = getUnixTime();

			const putParams = {
				TableName: this.tableName,
				Item: data.Item,
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: {
					'#ID': 'ID',
				},
			};

			const dbPut = this.db.put(putParams).promise();
			dbPut.then(() => {
				console.log('calling sendPaymentNotification');
				this.sendPaymentNotification(paymentInfo, data.Item);
				callback(null, createResponse({ statusCode: 200, body: data.Item }));
			}).catch((err) => {
				const returnResponse = createErrorResponse({ statusCode: 400, err });
				callback(null, returnResponse);
			});
		}).catch((err) => {
			callback(null, createErrorResponse({ statusCode: 400, body: err }));
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

		const timestamp = getUnixTime();
		const { Value, Enabled, ID } = body;
		const idList = [];
		// remove payment info, payment service is single point truth
		delete Value.paymentStatus;
		delete Value.paymentAuthCode;
		delete Value.paymentDate;
		// may not need to remove this delete Value.paymentToken;
		if (typeof body.Origin === 'undefined') {
			body.Origin = 'APP';
		}

		const item = {
			ID,
			Value,
			Enabled,
			Origin: body.Origin,
			Hash: hashToken(ID, Value, Enabled),
			Offset: timestamp,
		};

		idList.push(ID);
		this.getPaymentInformation(idList)
			.then((response) => {
				const params = {
					TableName: this.tableName,
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
						statusCode: 405,
					});
					callback(null, validationError);
				} else {
					const dbPut = this.db.put(params).promise();
					dbPut.then(() => {
						// stamp payment info if we have it
						if (response.payments !== null && typeof response.payments !== 'undefined') {
							item.Value.paymentStatus = response.payments[0].PenaltyStatus;
							item.Value.paymentAuthCode = response.payments[0].PaymentDetail.AuthCode;
							item.Value.paymentDate = response.payments[0].PaymentDetail.PaymentDate;
							// item.Hash = hashToken(ID, item.Value, Enabled); // recalc hash if payment found
						} else {
							item.Value.paymentStatus = 'UNPAID';
						}

						callback(null, createResponse({ statusCode: 200, body: item }));
					}).catch((err) => {
						const returnResponse = createErrorResponse({ statusCode: 400, err });
						callback(null, returnResponse);
					});
				}
			}).catch((err) => {
				const returnResponse = createErrorResponse({ statusCode: 400, err });
				callback(null, returnResponse);
			});
	}

	getPaymentInformation(idList) {
		// TODO remove this if before deploying... only for running local
		if (typeof this.paymentURL === 'undefined') {
			this.paymentURL = 'https://0yqui7ctd2.execute-api.eu-west-1.amazonaws.com/dev';
		}
		const url = `${this.paymentURL}/payments/batches`;
		const options = {
			method: 'POST',
			url,
			body: { ids: idList },
			headers: { Authorization: 'allow' },
			json: true,
		};

		return request(options);
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
		this.getPaymentInformation(idList)
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
						statusCode: 405,
					});
					callback(null, validationError);
				} else {

					const params = {
						TableName: this.tableName,
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
							statusCode: 405,
						});
						callback(null, validationError);
					} else {
						const dbUpdate = this.db.update(params).promise();

						dbUpdate.then(() => {
							callback(null, createResponse({ statusCode: 200, body: deletedItem }));
						}).catch((err) => {
							const errResponse = createErrorResponse({ statusCode: 400, body: err });
							callback(null, errResponse);
						});
					}
				}
			}).catch((err) => {
				callback(null, createErrorResponse({ statusCode: 400, body: err }));
			});
	}

	getDocuments(offset, exclusiveStartKey, callback) {

		const params = {
			TableName: this.tableName,
			IndexName: 'ByOffset',
			Limit: maxBatchSize,
		};
		let localOffset = offset;
		const date = new Date();

		if (typeof offset === 'undefined' || offset === '0') {
			localOffset = subtractDays(date, this.daysToHold);
		}

		if (typeof offset !== 'undefined') {
			params.KeyConditionExpression = 'Origin = :Origin and #Offset >= :Offset';
			// params.FilterExpression = '#Offset >= :Offset';
			params.ExpressionAttributeNames = { '#Offset': 'Offset' };
			params.ExpressionAttributeValues = { ':Offset': Number(localOffset), ':Origin': 'APP' };
			// could use ScanIndexForward of false to return in most recent order...
		}

		if (exclusiveStartKey !== 'undefined') {
			params.ExclusiveStartKey = exclusiveStartKey;
		}

		const dbScan = this.db.query(params).promise();
		const idList = [];

		dbScan.then((data) => {
			// TODO need to loop through data and populate with payment info
			const items = data.Items;

			if (data.Count > 0) {
				items.forEach((item) => {
					idList.push(item.ID);
					delete item.Value.paymentStatus;
					delete item.Value.paymentAuthCode;
					delete item.Value.paymentDate;
					delete item.Origin; // remove Origin as not needed in response
				});

				this.getPaymentInformation(idList)
					.then((response) => {
						let mergedList = [];
						mergedList = mergeDocumentsWithPayments({ items, payments: response.payments });
						callback(null, createResponse({
							statusCode: 200,
							body: { LastEvaluatedKey: data.LastEvaluatedKey, Items: mergedList },
						}));
					})
					.catch((err) => {
						callback(null, createErrorResponse({ statusCode: 400, err }));
					});
			} else {
				// no records found in scan so return empty
				callback(null, createResponse({
					statusCode: 200,
					body: { Items: [] },
				}));
			}
		}).catch((err) => {
			callback(null, createErrorResponse({ statusCode: 400, err }));
		});
	}

	getDocumentByToken(token, callback) {
		lambda.invoke({
			FunctionName: this.tokenServiceARN,
			Payload: `{"body": { "Token": "${token}" } }`,
		}, (error, data) => {
			if (error) {
				console.log('Token service returned an error');
				console.log(JSON.stringify(error, null, 2));
				callback(null, createErrorResponse({ statusCode: 400, error }));
			} else if (data.Payload) {
				try {
					const parsedPayload = JSON.parse(data.Payload);
					if (parsedPayload.statusCode === 400) {
						console.log('Token service returned an error');
						const parsedBody = JSON.parse(parsedPayload.body);
						callback(null, createErrorResponse({ statusCode: 400, err: { name: 'Token Error', message: parsedBody.message } }));
						return;
					}

					const parsedBody = JSON.parse(parsedPayload.body);
					const docType = docTypeMapping[parsedBody.DocumentType];
					const docID = `${parsedBody.Reference}_${docType}`;
					this.getDocument(docID, (err, res) => {
						console.log('res');
						console.log(JSON.stringify(res));
						if (res.statusCode === 404) {
							this.getPaymentInformation([docID])
								.then((response) => {
									const paymentInfo = {};
									if (response.payments !== null && typeof response.payments !== 'undefined' && response.payments.length > 0) {
										paymentInfo.paymentStatus = response.payments[0].PenaltyStatus;
										paymentInfo.paymentAuthCode = response.payments[0].PaymentDetail.AuthCode;
										paymentInfo.paymentDate = response.payments[0].PaymentDetail.PaymentDate;
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

									callback(null, createResponse({ statusCode: 200, body: minimalDocument }));
								})
								.catch((e) => {
									console.log(JSON.stringify(e, null, 2));
									callback(null, createErrorResponse({ statusCode: 400, e }));
								});
						} else if (res.statusCode === 200) {
							callback(null, createResponse({ statusCode: 200, body: JSON.parse(res.body) }));
						} else {
							callback(null, createErrorResponse({
								statusCode: 400,
								err: {
									name: 'Error from GetDocument',
									message: 'The GetDocument method returned an unhandled error',
								},
							}));
						}
					});
				} catch (e) {
					console.log(JSON.stringify(e, null, 2));
					callback(null, createErrorResponse({ statusCode: 400, e }));
				}
				return;
			}
			callback(null, createErrorResponse({
				statusCode: 400,
				err: {
					name: 'No data returned from Token Service',
					message: 'The token service returned no data, it is likely there was some issue decoding the provided token',
				},
			}));
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
		const savedPaymentStatus = item.Value.paymentStatus || 'UNPAID';
		let savedPaymentAuthCode;
		let savedPaymentDate;
		if (item.Value.paymentStatus === 'PAID') {
			savedPaymentAuthCode = item.Value.paymentAuthCode;
			savedPaymentDate = item.Value.paymentDate;
		}

		delete item.Value.paymentStatus;
		delete item.Value.paymentAuthCode;
		delete item.Value.paymentDate;
		if (typeof item.Origin === 'undefined') {
			item.Origin = 'APP';
		}
		const newHash = hashToken(key, Value, Enabled);

		const updatedItem = {
			Enabled,
			ID: key,
			Origin: item.Origin,
			Offset: timestamp,
			Hash: newHash,
			Value,
		};

		const params = {
			TableName: this.tableName,
			Key: {
				ID: key,
			},
			UpdateExpression: 'set #Value = :Value, #Hash = :Hash, #Offset = :Offset, #Enabled = :Enabled, #Origin = :Origin',
			ConditionExpression: 'attribute_not_exists(#ID) OR (attribute_exists(#ID) AND #Hash=:clientHash)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
				'#Hash': 'Hash',
				'#Enabled': 'Enabled',
				'#Value': 'Value',
				'#Offset': 'Offset',
				'#Origin': 'Origin',
			},
			ExpressionAttributeValues: {
				':clientHash': clientHash,
				':Enabled': Enabled,
				':Value': Value,
				':Hash': newHash,
				':Offset': timestamp,
				':Origin': item.Origin,
			},
		};

		return new Promise((resolve) => {
			const res = Validation.penaltyDocumentValidation(item);
			if (res.valid) {
				const dbUpdate = this.db.update(params).promise();
				dbUpdate.then(() => {
					updatedItem.Value.paymentStatus = savedPaymentStatus;
					if (savedPaymentStatus === 'PAID') {
						updatedItem.Value.paymentAuthCode = savedPaymentAuthCode;
						updatedItem.Value.paymentDate = savedPaymentDate;
					}
					resolve(createSimpleResponse({ statusCode: 200, body: updatedItem }));
				}).catch((err) => {
					updatedItem.Value.paymentStatus = savedPaymentStatus;
					if (savedPaymentStatus === 'PAID') {
						updatedItem.Value.paymentAuthCode = savedPaymentAuthCode;
						updatedItem.Value.paymentDate = savedPaymentDate;
					}
					resolve(createSimpleResponse({ statusCode: 400, body: updatedItem, error: err }));
				});
			} else {
				resolve(createSimpleResponse({
					statusCode: 400,
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
		});

		this.getPaymentInformation(idList)
			.then((response) => {
				let mergedList = [];
				mergedList = mergeDocumentsWithPayments({ items, payments: response.payments });
				this.asyncLoopOrdered(this, this.updateItem, mergedList).then((outputValue) => {
					const result = {
						Items: outputValue,
					};
					callback(null, createResponse({ statusCode: 200, body: result }));
				}).catch((err) => {
					callback(null, createResponse({ statusCode: 400, body: err }));
				});
			})
			.catch((err) => {
				callback(null, createErrorResponse({ statusCode: 400, err }));
			});
	}

	paymentMessageParams(paymentInfo, documentInfo) {
		const text = 'Payment has been made!';
		const aps = {
			'content-available': 1,
			badge: 0,
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

	apnsMessageParams(offset, count) {

		const text = 'New documents are available!';
		const site = 0;

		const aps = {
			// alert: {
			// 	title: 'DVSA Officer FPNs',
			// 	body: text,
			// },
			'content-available': 1,
			badge: count,
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

	streamDocuments(event, context, callback) {

		let minOffset = 9999999999.999;
		let count = 0;

		event.Records.forEach((record) => {
			const item = parse(record.dynamodb.NewImage);
			if (item.Offset < minOffset) {
				minOffset = item.Offset;
			}
			count += 1;
		});

		const params = this.apnsMessageParams(minOffset, count);
		sns.publish(params, (err, data) => {
			if (err) {
				console.error('Unable to send message. Error JSON:', JSON.stringify(err, null, 2));
			} else {
				console.log('Results from sending message: ', JSON.stringify(data, null, 2));
			}
		});
		callback(null, `Successfully processed ${event.Records.length} records.`);
	}

	getSites(event, context, callback) {
		const params = { Bucket: this.bucketName, Key: this.siteResource };
		s3.getObject(params, (err, data) => {
			if (err) {
				callback(null, createResponse({ statusCode: 400, body: err }));
			} else {
				callback(null, createStringResponse({ statusCode: 200, body: data.Body.toString('utf-8') }));
			}
		});
	}
}
