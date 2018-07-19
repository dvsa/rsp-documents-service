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
			return callback(null, createResponse({ statusCode: 500, body: `Insert failed: ${err}` }));
		}
	}

	async getPenaltyGroup(penaltyGroupId, callback) {
		const groupParams = {
			TableName: this.penaltyGroupTableName,
			Key: { ID: penaltyGroupId },
		};

		try {
			const penaltyGroupPromise = this.db.get(groupParams).promise();
			const penaltyGrpContainer = await penaltyGroupPromise;
			if (penaltyGrpContainer.Item) {
				const penaltyDocIds = penaltyGrpContainer.Item.PenaltyDocumentIds;

				const requestItems = penaltyDocIds.map(docId => ({
					ID: docId,
				}));
				const penaltyDocumentParams = { RequestItems: {} };
				penaltyDocumentParams.RequestItems[this.penaltyDocTableName] = { Keys: requestItems };
				const penaltyDocPromise = this.db.batchGet(penaltyDocumentParams).promise();

				const penaltyDocItemContainer = await penaltyDocPromise;

				const resp = penaltyGrpContainer.Item;
				resp.Penalties = penaltyDocItemContainer.Responses.penaltyDocuments;
				delete resp.PenaltyDocumentIds;

				callback(null, createResponse({ statusCode: 200, body: resp }));
			} else {
				callback(null, createResponse({ statusCode: 404, body: { error: 'ITEM NOT FOUND' } }));
			}
		} catch (err) {
			callback(null, createResponse({ statusCode: 503, body: err }));
		}
	}

	_enrichPenaltyGroupRequest(body) {
		const penGrp = { ...body };
		const { UserID, Timestamp, Penalties } = penGrp;
		const generatedId = `${Timestamp}${UserID}`.replace(/\D/g, '');
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

}
