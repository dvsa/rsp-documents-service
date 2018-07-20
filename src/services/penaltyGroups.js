/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */

import Validation from 'rsp-validation';

import createResponse from '../utils/createResponse';
import getUnixTime from '../utils/time';
import hashToken from '../utils/hash';

const appOrigin = 'APP';

export default class PenaltyGroup {

	constructor(db, penaltyDocTableName, penaltyGroupTableName) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
	}

	async createPenaltyGroup(body, callback) {
		if (process.env.DO_PENALTY_GROUP_VALIDATION) {
			const validationResult = Validation.penaltyGroupValidation(body);

			if (!validationResult.valid) {
				const errMsg = validationResult.error.message;
				return callback(null, createResponse({ statusCode: 400, body: `Bad request: ${errMsg}` }));
			}
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

			penaltyGroup.Penalties = await this._getPenaltiesWithIds(penaltyGroup.PenaltyDocumentIds);
			delete penaltyGroup.PenaltyDocumentIds;
			return callback(null, createResponse({ statusCode: 200, body: penaltyGroup }));
		} catch (err) {
			return callback(null, createResponse({ statusCode: 503, body: err.message }));
		}
	}

	_enrichPenaltyGroupRequest(body) {
		const penGrp = { ...body };
		const { UserID, Timestamp, Penalties } = penGrp;
		const paddedUserId = UserID.toString().padStart(6, '0');
		const compoundId = parseInt(`${Timestamp}${paddedUserId}`, 10);
		const generatedId = compoundId.toString(36);
		penGrp.ID = generatedId;
		penGrp.TotalAmount = Penalties.reduce((total, pen) => pen.Value.penaltyAmount + total, 0);
		penGrp.PaymentStatus = 'UNPAID';
		penGrp.Penalties.forEach((p) => {
			p.inPenaltyGroup = true;
			p.Hash = hashToken(p.ID, p.Value, p.Enabled);
			p.Origin = p.Origin || appOrigin;
			p.Offset = getUnixTime();
		});
		return penGrp;
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

}
