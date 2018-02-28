/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import AWS from 'aws-sdk';
import Joi from 'joi';
import hashToken from '../utils/hash';
import getUnixTime from '../utils/time';
import createResponse from '../utils/createResponse';
import createSimpleResponse from '../utils/createSimpleResponse';
import createErrorResponse from '../utils/createErrorResponse';
import createStringResponse from '../utils/createStringResponse';
import penaltyValidation from '../validationModels/penaltyValidation';

const parse = AWS.DynamoDB.Converter.unmarshall;
const sns = new AWS.SNS();
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });
const lambda = new AWS.Lambda({ region: 'eu-west-1' });
const docTypeMapping = ['FPN', 'IM', 'CDN'];

export default class PenaltyDocument {

	constructor(db, tableName, bucketName, snsTopicARN, siteResource, tokenServiceARN) {
		this.db = db;
		this.tableName = tableName;
		this.bucketName = bucketName;
		this.snsTopicARN = snsTopicARN;
		this.siteResource = siteResource;
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
			callback(null, createResponse({ statusCode: 200, body: data.Item }));
		}).catch((err) => {
			callback(null, createErrorResponse({ statusCode: 400, body: err }));
		});
	}

	createDocument(body, callback) {

		const timestamp = getUnixTime();
		const { Value, Enabled, ID } = body;

		const item = {
			ID,
			Value,
			Enabled,
			Hash: hashToken(ID, Value, Enabled),
			Offset: timestamp,
		};

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
				callback(null, createResponse({ statusCode: 200, body: item }));
			}).catch((err) => {
				const response = createErrorResponse({ statusCode: 400, err });
				callback(null, response);
			});
		}
	}

	// Update
	updateDocument(id, body, callback) {

		// TODO: Verifiy Data
		const timestamp = getUnixTime();
		const { Enabled, Value, Hash } = body;

		const newHash = hashToken(id, Value, Enabled);
		const params = {
			TableName: this.tableName,
			Key: {
				ID: id,
			},
			UpdateExpression: 'set #Value = :Value, #Hash = :Hash, #Offset = :Offset, #Enabled = :Enabled',
			ConditionExpression: 'attribute_exists(#ID) AND #Hash=:clientHash',
			ExpressionAttributeNames: {
				'#ID': 'ID',
				'#Hash': 'Hash',
				'#Enabled': 'Enabled',
				'#Value': 'Value',
				'#Offset': 'Offset',
			},
			ExpressionAttributeValues: {
				':clientHash': Hash,
				':Enabled': Enabled,
				':Value': Value,
				':Hash': newHash,
				':Offset': timestamp,
			},
		};

		const updatedItem = {
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
				callback(null, createResponse({ statusCode: 200, body: updatedItem }));
			}).catch((err) => {
				const response = createErrorResponse({ statusCode: 400, err });
				callback(null, response);
			});
		}
	}

	// Delete
	deleteDocument(id, body, callback) {
		const timestamp = getUnixTime();
		const clientHash = body.Hash;
		const Enabled = false;
		const { Value } = body;

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

	getDocuments(offset, callback) {

		const params = {
			TableName: this.tableName,
		};

		if (offset !== 'undefined')	{
			params.ExpressionAttributeNames = { '#Offset': 'Offset' };
			params.FilterExpression = '#Offset >= :Offset';
			params.ExpressionAttributeValues = { ':Offset': Number(offset) };
		}

		const dbScan = this.db.scan(params).promise();

		dbScan.then((data) => {
			callback(null, createResponse({ statusCode: 200, body: data }));
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
				callback(error, null);
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
				console.log(`success ${res.valid}`);
				const dbUpdate = this.db.update(params).promise();
				dbUpdate.then(() => {
					resolve(createSimpleResponse({ statusCode: 200, body: updatedItem }));
				}).catch((err) => {
					// const error = {
					// 	ID: key,
					// 	error: res.response,
					// };
					console.log(`errored - in catch ${err}`);
					console.log(JSON.stringify(res, null, 2));
					resolve(createSimpleResponse({ statusCode: 400, body: updatedItem, error: err }));
				});
			} else {
				console.log(`fail ${res.valid}`);
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
		this.asyncLoopOrdered(this, this.updateItem, items).then((outputValue) => {
			const result = {
				Items: outputValue,
			};
			callback(null, createResponse({ statusCode: 200, body: result }));
		}).catch((err) => {
			callback(null, createResponse({ statusCode: 400, body: err }));
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

		console.log(event);

		event.Records.forEach((record) => {
			const item = parse(record.dynamodb.NewImage);
			if (item.Offset > maxOffset) {
				maxOffset = item.Offset;
			}
			count += 1;
			updatedIds.push(item.ID);
		});
		const params = this.apnsMessageParams(maxOffset, count, updatedIds);
		console.log(params);
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
		console.log(event);

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
		console.log(JSON.stringify(validationResult, null, 2));
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
				console.log(`matches found ${matches[1]}  ${matches[2]} ${matches[3]}`);
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
				console.log(`matches found ${idMatches[1]}  ${idMatches[2]} ${idMatches[3]}`);
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
