/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import AWS from 'aws-sdk';
import Joi from 'joi';
import request from 'request-promise';
import hashToken from '../utils/hash';
import getUnixTime from '../utils/time';
import createResponse from '../utils/createResponse';
import createSimpleResponse from '../utils/createSimpleResponse';
import createErrorResponse from '../utils/createErrorResponse';
import createStringResponse from '../utils/createStringResponse';
import mergeDocumentsWithPayments from '../utils/mergeDocumentsWithPayments';
import penaltyValidation from '../validationModels/penaltyValidation';

const parse = AWS.DynamoDB.Converter.unmarshall;
const sns = new AWS.SNS();
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
const lambda = new AWS.Lambda({ region: 'eu-west-1' });
const docTypeMapping = ['FPN', 'IM', 'CDN'];

const maxBatchSize = 75;

export default class PenaltyDocument {

	constructor(db, tableName, bucketName, snsTopicARN, siteResource, paymentURL, tokenServiceARN) {
		this.db = db;
		this.tableName = tableName;
		this.bucketName = bucketName;
		this.snsTopicARN = snsTopicARN;
		this.siteResource = siteResource;
		this.paymentURL = paymentURL;
		this.tokenServiceARN = tokenServiceARN;
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
			if (!data.Item) {
				callback(null, createResponse(404, 'ITEM NOT FOUND'));
				return;
			}
			const idList = [];
			idList.push(id);
			this.getPaymentInformation(idList)
				.then((response) => {
					console.log(JSON.stringify(response, null, 2));
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

	// put
	updateDocumentWithPayment(id, paymentStatus, callback) {
		const getParams = {
			TableName: this.tableName,
			Key: {
				ID: id,
			},
		};
		const dbGet = this.db.get(getParams).promise();

		dbGet.then((data) => {
			if (!data.Item) {
				callback(null, createResponse(404, 'ITEM NOT FOUND'));
				return;
			}

			data.Item.Value.paymentStatus = paymentStatus;
			data.Item.Hash = hashToken(id, data.Item.Value, data.Item.Enabled);
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
				callback(null, createResponse({ statusCode: 200, body: data.Item }));
			}).catch((err) => {
				const returnResponse = createErrorResponse({ statusCode: 400, err });
				callback(null, returnResponse);
			});
		}).catch((err) => {
			callback(null, createErrorResponse({ statusCode: 400, body: err }));
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
		const item = {
			ID,
			Value,
			Enabled,
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

				const checkTest = this.validatePenalty(body, penaltyValidation, false);
				if (!checkTest.valid) {
					callback(null, checkTest.response);
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

		const checkTest = this.validatePenalty(body, penaltyValidation, true);
		if (!checkTest.valid) {
			callback(null, checkTest.response);
		} else {
			const dbUpdate = this.db.update(params).promise();

			dbUpdate.then(() => {
				callback(null, createResponse({ statusCode: 200, body: deletedItem }));
			}).catch((err) => {
				const response = createErrorResponse({ statusCode: 400, body: err });
				callback(null, response);
			});
		}
	}

	getDocuments(offset, exclusiveStartKey, callback) {

		const params = {
			TableName: this.tableName,
			Limit: maxBatchSize,
		};

		if (offset !== 'undefined') {
			params.ExpressionAttributeNames = { '#Offset': 'Offset' };
			params.FilterExpression = '#Offset >= :Offset';
			params.ExpressionAttributeValues = { ':Offset': Number(offset) };
		}

		if (exclusiveStartKey !== 'undefined') {
			params.ExclusiveStartKey = { ID: exclusiveStartKey };
		}

		const dbScan = this.db.scan(params).promise();
		const idList = [];

		dbScan.then((data) => {
			// TODO need to loop through data and populate with payment info
			const items = data.Items;

			console.log(JSON.stringify(data, null, 2));
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

					if (typeof data.LastEvaluatedKey !== 'undefined') {
						console.log(`LastEvaluatedKey ${data.LastEvaluatedKey}`);
						console.log(JSON.stringify(mergedList, null, 2));
					}

					callback(null, createResponse({
						statusCode: 200,
						body: mergedList,
					}));

					// TODO to make batch fetch work the app will need to change to read
					// items from Items array within body instead of from body direct
					// and read the LastEvaluated key and issue next call with
					// ExclusiveStartKey passed in the URL
					// callback(null, createResponse({
					// 	statusCode: 200,
					// 	body: { LastEvaluatedKey: data.LastEvaluatedKey, Items: mergedList },
					// }));
				})
				.catch((err) => {
					callback(null, createErrorResponse({ statusCode: 400, err }));
				});
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
				console.log(JSON.stringify(data, null, 2));
				const parsedPayload = JSON.parse(data.Payload);
				const docType = docTypeMapping[parsedPayload.body.DocumentType];
				this.getDocument(`${parsedPayload.body.Reference}_${docType}`, callback);
			}
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

		const newHash = hashToken(key, Value, Enabled);

		const updatedItem = {
			Enabled,
			ID: key,
			Offset: timestamp,
			Hash: newHash,
			Value,
		};

		const params = {
			TableName: this.tableName,
			Key: {
				ID: key,
			},
			UpdateExpression: 'set #Value = :Value, #Hash = :Hash, #Offset = :Offset, #Enabled = :Enabled',
			ConditionExpression: 'attribute_not_exists(#ID) OR (attribute_exists(#ID) AND #Hash=:clientHash)',
			ExpressionAttributeNames: {
				'#ID': 'ID',
				'#Hash': 'Hash',
				'#Enabled': 'Enabled',
				'#Value': 'Value',
				'#Offset': 'Offset',
			},
			ExpressionAttributeValues: {
				':clientHash': clientHash,
				':Enabled': Enabled,
				':Value': Value,
				':Hash': newHash,
				':Offset': timestamp,
			},
		};

		return new Promise((resolve) => {
			const res = this.validatePenalty(item, penaltyValidation, false);
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
					error: res.response.err,
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

	apnsMessageParams(offset, count, ids) {

		const text = 'New documents are available!';

		const aps = {
			alert: {
				title: 'DVSA Officer FPNs',
				body: text,
			},
			'content-available': 1,
			badge: count,
		};

		const message = {
			default: text,
			APNS: JSON.stringify({
				aps,
				offset,
				ids,
			}),

			APNS_SANDBOX: JSON.stringify({
				aps,
				offset,
				ids,
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

		let maxOffset = 0.0;
		let count = 0;
		const updatedIds = [];

		event.Records.forEach((record) => {
			const item = parse(record.dynamodb.NewImage);
			if (item.Offset > maxOffset) {
				maxOffset = item.Offset;
			}
			count += 1;
			updatedIds.push(item.ID);
		});
		const params = this.apnsMessageParams(maxOffset, count, updatedIds);
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
				console.log(err, err.stack); // an error occurred
				callback(null, createResponse({ statusCode: 400, body: err }));
			} else {
				console.log(data); // successful response
				callback(null, createStringResponse({ statusCode: 200, body: data.Body.toString('utf-8') }));
			}
		});
	}

	validatePenalty(data, penaltyValidationModel) {
		const validationResult = Joi.validate(data, penaltyValidationModel.request);
		if (validationResult.error) {
			const err = 'Invalid Input';
			const error = createResponse({
				body: {
					err,
				},
				statusCode: 405,
			});
			return { valid: false, response: error };
		}

		// additional validations
		if (data.Value.penaltyType !== 'IM' && data.ID !== `${data.Value.referenceNo}_${data.Value.penaltyType}`) {
			const errMsg = 'ID does not match referenceNo and penaltyType';
			const error = createResponse({
				body: {
					errMsg,
				},
				statusCode: 405,
			});
			return { valid: false, response: error };
		}

		if (data.Value.penaltyType !== 'IM' && data.Value.referenceNo.length < 12) {
			const errMsg = 'ReferenceNo is too short';
			const error = createResponse({
				body: {
					errMsg,
				},
				statusCode: 405,
			});
			return { valid: false, response: error };
		}

		if (data.Value.penaltyType !== 'IM' && data.Value.referenceNo.length > 13) {
			const errMsg = 'ReferenceNo is too long';
			const error = createResponse({
				body: {
					errMsg,
				},
				statusCode: 405,
			});
			return { valid: false, response: error };
		}

		if (data.Value.penaltyType === 'IM') {

			if (!data.Value.referenceNo.match(/^[0-9]{1,6}-[0-1]-[0-9]{1,6}-IM$/)) {
				const errMsg = 'ReferenceNo should be 999999-9-999999-IM format';
				const error = createResponse({
					body: {
						errMsg,
					},
					statusCode: 405,
				});
				return { valid: false, response: error };
			}

			const matches = data.Value.referenceNo.match(/^([0-9]{1,6})-([0-1])-([0-9]{1,6})-IM$/);

			let initialSegment;
			let lastSegment;
			let middleSegment;

			if (matches.length > 3) {
				initialSegment = Number(matches[1]);
				middleSegment = Number(matches[2]);
				lastSegment = Number(matches[3]);
				if (initialSegment === 0 || lastSegment === 0) {
					const errMsg = 'Officer Id or Issued Count cannot be zero';
					const error = createResponse({
						body: {
							errMsg,
						},
						statusCode: 405,
					});
					return { valid: false, response: error };
				}
			}
			// match first and last segments
			const idMatches = data.ID.match(/^([0-9]{6})([0-1])([0-9]{6})_IM$/);
			if (idMatches.length > 3) {
				const idInitialSegment = Number(idMatches[1]);
				const idMiddleSegment = Number(idMatches[2]);
				const idLastSegment = Number(idMatches[3]);

				if (idInitialSegment !== initialSegment ||
					idLastSegment !== lastSegment ||
					idMiddleSegment !== middleSegment) {
					const errMsg = 'ID does not match referenceNo and penaltyType';
					const error = createResponse({
						body: {
							errMsg,
						},
						statusCode: 405,
					});
					return { valid: false, response: error };
				}
			}
		}
		return { valid: true, response: {} };
	}
}
