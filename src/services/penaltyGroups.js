/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
/* eslint-disable */

import Validation from 'rsp-validation';

import createResponse from '../utils/createResponse';
import createErrorResponse from '../utils/createErrorResponse';
import getUnixTime from '../utils/time';
import hashToken from '../utils/hash';

const appOrigin = 'APP';

export default class PenaltyGroup {

	constructor(db, penaltyDocTableName, penaltyGroupTableName) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
		this.maxBatchSize = 75;
	}

	async createPenaltyGroup(body, callback) {
		const validationResult = Validation.penaltyGroupValidation(body);
		if (!validationResult.valid) {
			const errMsg = validationResult.error.message;
			return callback(null, createResponse({ statusCode: 400, body: `Bad request: ${errMsg}` }));
		}

		const penaltyGroup = this._enrichPenaltyGroupRequest(body);
		const batchWriteParams = this._createPenaltyGroupPutParameters(penaltyGroup);

		try {
			await this.db.batchWrite(batchWriteParams).promise();
			return callback(null, createResponse({ statusCode: 201, body: penaltyGroup }));
		} catch (err) {
			return callback(null, createResponse({ statusCode: 503, body: `Problem writing to DB: ${err}` }));
		}
	}

	async getPenaltyGroup(penaltyGroupId, callback) {
		try {
			const penaltyGroup = await this._getPenaltyGroupById(penaltyGroupId);

			if (!penaltyGroup) {
				const msg = `Penalty Group ${penaltyGroupId} not found`;
				return callback(null, createResponse({ statusCode: 404, body: { error: msg } }));
			}

			const penaltyDocs = await this._getPenaltiesWithIds(penaltyGroup.PenaltyDocumentIds);
			penaltyGroup.Payments = this._groupPenaltyDocsToPayments(penaltyDocs);
			delete penaltyGroup.PenaltyDocumentIds;
			return callback(null, createResponse({ statusCode: 200, body: penaltyGroup }));
		} catch (err) {
			return callback(null, createResponse({ statusCode: 503, body: err.message }));
		}
	}

	async listPenaltyGroups(offsetFrom, callback) {
		try {
			const params = {
				TableName: this.penaltyGroupTableName,
				IndexName: 'ByOffset',
				Limit: this.maxBatchSize,
				KeyConditionExpression: '#Origin = :Origin and #Offset > :Offset',
				ExpressionAttributeNames: { '#Offset': 'Offset', '#Origin': 'Origin' },
				ExpressionAttributeValues: { ':Offset': offsetFrom, ':Origin': 'APP' },
			};

			const result = await this.db.query(params).promise();
			return callback(null, createResponse({ statusCode: 200, body: result }));
		} catch (error) {
			const resp = createResponse({ statusCode: 500, body: error });
			return callback(null, resp);
		}
	}

	async delete(penaltyGroupId, callback) {
		const { PenaltyDocumentIds } = await this._getPenaltyGroupById(penaltyGroupId);
		await this.db.update({
			TableName: this.penaltyGroupTableName,
			Key: {
				ID: penaltyGroupId,
			},
			UpdateExpression: 'set #e = :e',
			ExpressionAttributeNames: { '#e': 'Enabled' },
			ExpressionAttributeValues: {
				':e' : false,
			},
		}).promise();
		const documentUpdatePromises = PenaltyDocumentIds.map((id) => {
			const updateParams = {
				TableName: this.penaltyDocTableName,
				Key: {
					ID: id,
				},
				UpdateExpression: 'set #e = :e',
				ExpressionAttributeNames: { '#e': 'Enabled' },
				ExpressionAttributeValues: {
					':e': false,
				},
			};
			return this.db.update(updateParams).promise();
		});
		await Promise.all(documentUpdatePromises);
		return callback(null, createResponse({ statusCode: 204, body: {} }));
	}

	updatePenaltyGroupWithPayment(paymentInfo, callback) {
		const getParams = {
			TableName: this.penaltyGroupTableName,
			Key: {
				ID: paymentInfo.id,
			},
		};
		const dbGet = this.db.get(getParams).promise();

		dbGet.then((data) => {
			data.Item.PaymentStatus = paymentInfo.paymentStatus;
			// TODO: Implement 'Enabled' flag (indicates whether or not a penalty group has been deleted)
			data.Item.Hash = hashToken(paymentInfo.id, data.Item, true);
			data.Item.Offset = getUnixTime();

			const putParams = {
				TableName: this.penaltyGroupTableName,
				Item: data.Item,
				ConditionExpression: 'attribute_exists(#ID)',
				ExpressionAttributeNames: {
					'#ID': 'ID',
				},
			};

			const dbPut = this.db.put(putParams).promise();
			dbPut.then(() => {
				if (data.Item.Origin === appOrigin) {
					// TODO: Send payment notification
				}
				callback(null, createResponse({ statusCode: 200, body: data.Item }));
			}).catch((err) => {
				const returnResponse = createErrorResponse({ statusCode: 400, err });
				callback(null, returnResponse);
			});
		}).catch((err) => {
			callback(null, createErrorResponse({ statusCode: 400, body: err }));
		});
	}

	_enrichPenaltyGroupRequest(body) {
		const penGrp = { ...body };
		const { Timestamp, SiteCode, Penalties } = penGrp;
		const penaltyGroupId = PenaltyGroup.generatePenaltyGroupId(Timestamp, SiteCode);
		penGrp.ID = penaltyGroupId;
		penGrp.TotalAmount = Penalties.reduce((total, pen) => pen.Value.penaltyAmount + total, 0);
		penGrp.Offset = Date.now() / 1000;
		penGrp.PaymentStatus = 'UNPAID';
		penGrp.Origin = penGrp.Origin || appOrigin;
		penGrp.Enabled = true;
		penGrp.Penalties.forEach((p) => {
			p.inPenaltyGroup = true;
			p.Hash = hashToken(p.ID, p.Value, p.Enabled);
			p.Origin = p.Origin || appOrigin;
			p.Offset = getUnixTime();
		});
		return penGrp;
	}

	static generatePenaltyGroupId(timestamp, siteCode) {
		const absoluteSiteCode = Math.abs(siteCode);
		const lengthOfSiteCode = Math.ceil(Math.log10(absoluteSiteCode));
		const numberOfOnes = siteCode < 0 ? 1 : 0;
		const lengthOfPaddedSiteCode = 4;
		const numberOfZeros = lengthOfPaddedSiteCode - lengthOfSiteCode - numberOfOnes;
		const paddedSiteCode = `${'1'.repeat(numberOfOnes)}${'0'.repeat(numberOfZeros)}${absoluteSiteCode}`;

		const parsedTimestamp = timestamp.toFixed(3) * 1000;

		const concatId = parseInt(`${parsedTimestamp}${paddedSiteCode}`, 10);
		const encodedConcatId = concatId.toString(36);
		return encodedConcatId;
	}

	_createPenaltyGroupPutParameters(penaltyGroup) {
		const groupPutRequest = {
			PutRequest: {
				Item: this._createPersistablePenaltyGroup(penaltyGroup),
			},
		};
		const penaltyPutRequests = penaltyGroup.Penalties.map(p => ({
			PutRequest: {
				Item: p,
			},
		}));

		const requestItems = {};
		requestItems[this.penaltyDocTableName] = penaltyPutRequests;
		requestItems[this.penaltyGroupTableName] = [groupPutRequest];

		const batchParams = {
			RequestItems: requestItems,
		};
		return batchParams;
	}

	_createPersistablePenaltyGroup(penaltyGroup) {
		const persistableGrp = { ...penaltyGroup };
		persistableGrp.PenaltyDocumentIds = persistableGrp.Penalties.map(p => p.ID);
		delete persistableGrp.Penalties;
		return persistableGrp;
	}

	async _getPenaltyGroupById(penaltyGroupId) {
		return new Promise(async (resolve, reject) => {
			try {
				const groupParams = {
					TableName: this.penaltyGroupTableName,
					Key: { ID: penaltyGroupId },
				};
				const penaltyGroupContainer = await this.db.get(groupParams).promise();
				resolve(penaltyGroupContainer.Item);
			} catch (err) {
				reject(new Error(`Problem fetching penaltyGroup: ${err}`));
			}
		});
	}

	async _getPenaltiesWithIds(penaltyIds) {
		return new Promise(async (resolve, reject) => {
			try {
				const requestItems = penaltyIds.map(docId => ({
					ID: docId,
				}));
				const penaltyDocumentParams = { RequestItems: {} };
				penaltyDocumentParams.RequestItems[this.penaltyDocTableName] = { Keys: requestItems };
				const penaltyDocPromise = this.db.batchGet(penaltyDocumentParams).promise();

				const penaltyDocItemContainer = await penaltyDocPromise;
				resolve(penaltyDocItemContainer.Responses.penaltyDocuments);
			} catch (err) {
				reject(new Error(`Problem fetching penaltyDocuments: ${err}`));
			}
		});
	}

	_groupPenaltyDocsToPayments(penaltyDocs) {
		const penaltiesByType = penaltyDocs.reduce((payments, doc) => {
			const { penaltyType } = doc.Value;
			if (Object.keys(payments).includes(penaltyType)) {
				payments[penaltyType].push(doc);
			}
			return payments;
		}, { FPN: [], IM: [], CDN: [] });

		const paymentList = Object.keys(penaltiesByType).map(categoryName => ({
			PaymentCategory: categoryName,
			TotalAmount: penaltiesByType[categoryName]
				.reduce((total, penalty) => total + penalty.Value.penaltyAmount, 0),
			PaymentStatus: penaltiesByType[categoryName]
				.every(penalty => penalty.Value.paymentStatus === 'PAID') ? 'PAID' : 'UNPAID',
			Penalties: penaltiesByType[categoryName],
		}));

		return paymentList.filter(group => group.Penalties.length > 0);
	}

}
