/* eslint class-methods-use-this: "off" */
/* eslint-env es6 */
import { SNS } from 'aws-sdk';
import Validation from 'rsp-validation';

import config from '../config';
import createResponse from '../utils/createResponse';
import createErrorResponse from '../utils/createErrorResponse';
import getUnixTime from '../utils/time';
import hashToken from '../utils/hash';
import ErrorCode from '../utils/errorCode';
import createErrorCodedResponse from '../utils/createErrorCodedResponse';
import HttpStatus from '../utils/httpStatusCode';

const sns = new SNS();
const appOrigin = 'APP';

/** @typedef {{ ID: String, Enabled: boolean }} PenaltyDocument */
/** @typedef
 * {(err: any, response: {statusCode: number, body: any, headers: any}) => void} LambdaCallback
 */


export default class PenaltyGroup {

	constructor(db, penaltyDocTableName, penaltyGroupTableName, snsTopicARN) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
		this.maxBatchSize = config.dynamodbMaxBatchSize();
		this.snsTopicARN = snsTopicARN;
	}

	async createPenaltyGroup(body) {
		const validationResult = await this.validatePenaltyGroupCreationPayload(body);
		if (!validationResult.valid) {
			return validationResult.response;
		}

		const penaltyGroup = this._enrichPenaltyGroupRequest(body);
		const batchWriteParams = this._createPenaltyGroupPutParameters(penaltyGroup);

		try {
			await this.db.batchWrite(batchWriteParams).promise();
			return createResponse({
				statusCode: HttpStatus.CREATED,
				body: penaltyGroup,
			});
		} catch (err) {
			return createResponse({
				statusCode: HttpStatus.SERVICE_UNAVAILABLE,
				body: `Problem writing to DB: ${err}`,
			});
		}
	}

	async validatePenaltyGroupCreationPayload(payload) {
		const schemaValidationResult = Validation.penaltyGroupValidation(payload);
		if (!schemaValidationResult.valid) {
			const errMsg = schemaValidationResult.error.message;
			console.log(`Got payload: ${JSON.stringify(payload)}`);
			return { valid: false, response: this.groupValidationFailedResponse(errMsg) };
		}

		const newDocIds = payload.Penalties.map(p => p.ID);
		const existingDocsWithIds = await this._getPenaltyDocumentsWithIds(newDocIds);
		const allExistingDocsDisabled = existingDocsWithIds.every(p => p.Enabled === false);
		if (existingDocsWithIds.length !== 0 && !allExistingDocsDisabled) {
			const clashingIds = existingDocsWithIds.map(doc => doc.ID);
			return { valid: false, response: this.duplicateReferenceResponse(clashingIds) };
		}

		return { valid: true };
	}

	groupValidationFailedResponse(validationResponse) {
		return createErrorCodedResponse(
			HttpStatus.BAD_REQUEST,
			ErrorCode.GROUP_VALIDATION,
			'Schema validation failed',
			{
				validationError: validationResponse,
			},
		);
	}

	/**
	 * @param {String[]} clashingIds
	 */
	duplicateReferenceResponse(clashingIds) {
		return createErrorCodedResponse(
			HttpStatus.BAD_REQUEST,
			ErrorCode.GROUP_DUPLICATE_REFERENCE,
			'One or more penalties already exist with the supplied reference codes',
			{
				clashingIds,
			},
		);
	}

	/**
	 * @param {String} penaltyGroupId
	 */
	async getPenaltyGroup(penaltyGroupId) {
		try {
			const penaltyGroup = await this._getPenaltyGroupById(penaltyGroupId);

			if (!penaltyGroup) {
				const msg = `Penalty Group ${penaltyGroupId} not found`;
				return createResponse({
					statusCode: HttpStatus.NOT_FOUND,
					body: { error: msg },
				});
			}

			const penaltyDocs = await this._getPenaltiesWithIds(penaltyGroup.PenaltyDocumentIds);
			penaltyGroup.Payments = this._groupPenaltyDocsToPayments(penaltyDocs);
			delete penaltyGroup.PenaltyDocumentIds;
			return createResponse({ statusCode: HttpStatus.OK, body: penaltyGroup });
		} catch (err) {
			return createResponse({
				statusCode: HttpStatus.SERVICE_UNAVAILABLE,
				body: err.message,
			});
		}
	}

	async listPenaltyGroups(offsetFrom) {
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
			return createResponse({ statusCode: HttpStatus.OK, body: result });
		} catch (error) {
			const resp = createResponse({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, body: error });
			return resp;
		}
	}

	async delete(penaltyGroupId, callback) {
		try {
			const group = await this._getPenaltyGroupById(penaltyGroupId);
			const penaltyDocuments = await this._getPenaltyDocumentsWithIds(group.PenaltyDocumentIds);

			if (this._documentsIndicateGroupWhollyUnpaid(penaltyDocuments)) {
				await this._disableGroupAndPenalties(penaltyGroupId, penaltyDocuments);
			} else {
				await this._spliceUnpaidPenaltiesFromGroup(group, penaltyDocuments);
			}

			return callback(null, createResponse({ statusCode: HttpStatus.NO_CONTENT }));
		} catch (error) {
			console.log(error);
			return callback(null, createResponse({
				statusCode: HttpStatus.BAD_REQUEST,
				body: error.message,
			}));
		}
	}

	_documentsIndicateGroupWhollyUnpaid(penaltyDocuments) {
		return !penaltyDocuments.some(doc => doc.Value.paymentStatus === 'PAID');
	}

	async _disableGroupAndPenalties(penaltyGroupId, penaltyDocuments) {
		const groupParams = this._disableIdInTableParams(this.penaltyGroupTableName, penaltyGroupId);
		await this.db.update(groupParams).promise();

		const docIdsToHashes = penaltyDocuments.map(doc => ({
			id: doc.ID,
			hash: hashToken(doc.ID, doc.Value, false),
		}));

		const documentUpdatePromises = docIdsToHashes.map((idToHash) => {
			const updateParams = this._disableIdInTableParams(
				this.penaltyDocTableName,
				idToHash.id,
				idToHash.hash,
			);
			return this.db.update(updateParams).promise();
		});
		await Promise.all(documentUpdatePromises);
	}

	async _spliceUnpaidPenaltiesFromGroup(group, penaltyDocs) {
		const { paidIds, unpaidIds } = this._groupPenaltyIdsByPaymentStatus(penaltyDocs);
		const amendedGroup = this._amendGroupRemovingUnpaidPenalties(group, penaltyDocs, paidIds);
		const groupAmendmentPromise = this._persistPenaltyGroup(amendedGroup);
		const documentDestroyPromise = this._destroyPenaltiesWithIds(unpaidIds);
		await Promise.all([groupAmendmentPromise, documentDestroyPromise]);
	}

	_amendGroupRemovingUnpaidPenalties(penaltyGroup, penaltyDocuments, paidIds) {
		const amendedGroup = { ...penaltyGroup };
		const paidPenaltyDocuments = penaltyDocuments
			.filter(doc => paidIds.includes(doc.ID));
		amendedGroup.Offset = getUnixTime();
		amendedGroup.PaymentStatus = 'PAID';
		amendedGroup.TotalAmount = paidPenaltyDocuments
			.reduce((sum, doc) => sum + doc.Value.penaltyAmount, 0);
		amendedGroup.VehicleRegistration = paidPenaltyDocuments
			.map(doc => doc.Value.vehicleDetails.regNo)
			.join(',');
		amendedGroup.Enabled = false;
		amendedGroup.PenaltyDocumentIds = paidIds;
		amendedGroup.Hash = hashToken(amendedGroup.ID, amendedGroup, amendedGroup.Enabled);
		return amendedGroup;
	}

	_groupPenaltyIdsByPaymentStatus(penaltyDocuments) {
		return penaltyDocuments
			.reduce(
				(idPaidSplit, document) => {
					const docPaymentStatus = document.Value.paymentStatus;
					const docId = document.ID;
					if (docPaymentStatus === 'PAID') {
						return { paidIds: [docId, ...idPaidSplit.paidIds], unpaidIds: idPaidSplit.unpaidIds };
					}
					return { paidIds: idPaidSplit.paidIds, unpaidIds: [docId, ...idPaidSplit.unpaidIds] };
				},
				{ paidIds: [], unpaidIds: [] },
			);
	}

	_persistPenaltyGroup(penaltyGroup) {
		const putParams = {
			TableName: this.penaltyGroupTableName,
			Item: penaltyGroup,
		};
		return this.db.put(putParams).promise();
	}

	async _destroyPenaltiesWithIds(documentIds) {
		const deletePromises = documentIds.map((docId) => {
			return this.db.delete({
				TableName: this.penaltyDocTableName,
				Key: {
					ID: docId,
				},
			}).promise();
		});
		return Promise.all(deletePromises);
	}

	async updatePenaltyGroupWithPayment(paymentInfo, callback) {
		const { id, paymentStatus, penaltyType } = paymentInfo;
		const oldPaymentStatus = paymentStatus === 'PAID' ? 'UNPAID' : 'PAID';
		try {
			const penaltyGroup = await this._getPenaltyGroupById(id);
			const penaltyDocs = await this._getPenaltiesWithIds(penaltyGroup.PenaltyDocumentIds);
			const penaltiesByType = this._groupPenaltiesByType(penaltyDocs);
			const penaltiesToUpdate = penaltiesByType[penaltyType];
			const batchWriteParams = this._createUpdatePenaltiesPutParameters(
				penaltiesToUpdate,
				this.penaltyDocTableName,
				paymentStatus,
			);
			// Update penalties
			await this.db.batchWrite(batchWriteParams).promise();
			// Check if all other penalties have been paid
			const otherPenalties = penaltyDocs.filter(p => p.Value.penaltyType !== penaltyType);
			const anyOutstanding = otherPenalties.some(p => p.Value.paymentStatus === oldPaymentStatus);
			if (!anyOutstanding) {
				// Update penalty group payment status if all penalties have been paid
				penaltyGroup.PaymentStatus = paymentStatus;
				penaltyGroup.Hash = hashToken(id, penaltyGroup, penaltyGroup.Enabled);
				penaltyGroup.Offset = getUnixTime();

				const putParams = {
					TableName: this.penaltyGroupTableName,
					Item: penaltyGroup,
					ConditionExpression: 'attribute_exists(#ID)',
					ExpressionAttributeNames: {
						'#ID': 'ID',
					},
				};

				await this.db.put(putParams).promise();

				if (penaltyGroup.Origin === appOrigin) {
					paymentInfo.paymentAmount = PenaltyGroup.sumPenaltyAmounts(penaltiesToUpdate);
					this.sendPaymentNotification(paymentInfo, penaltiesToUpdate[0]);
				}

				callback(null, createResponse({ statusCode: HttpStatus.OK, body: penaltyGroup }));
				return;
			}
			if (penaltyGroup.Origin === appOrigin) {
				paymentInfo.paymentAmount = PenaltyGroup.sumPenaltyAmounts(penaltiesToUpdate);
				this.sendPaymentNotification(paymentInfo, penaltiesToUpdate[0]);
			}
			callback(null, createResponse({ statusCode: HttpStatus.OK, body: penaltyGroup }));
		} catch (err) {
			callback(null, createErrorResponse({ statusCode: HttpStatus.INTERNAL_SERVER_ERROR, err }));
		}
	}

	_enrichPenaltyGroupRequest(body) {
		const penGrp = { ...body };
		const { Timestamp, SiteCode, Penalties } = penGrp;
		const penaltyGroupId = PenaltyGroup.generatePenaltyGroupId(Timestamp, SiteCode);
		penGrp.VehicleRegistration = penGrp.VehicleRegistration.replace(/ /g, '').toUpperCase();
		penGrp.ID = penaltyGroupId;
		penGrp.TotalAmount = Penalties.reduce((total, pen) => pen.Value.penaltyAmount + total, 0);
		penGrp.Offset = Date.now() / 1000;
		penGrp.PaymentStatus = 'UNPAID';
		penGrp.Origin = penGrp.Origin || appOrigin;
		penGrp.Enabled = true;
		penGrp.Hash = hashToken(penaltyGroupId, penGrp, penGrp.Enabled);
		penGrp.Penalties.forEach((p) => {
			p.inPenaltyGroup = true;
			p.penaltyGroupId = penaltyGroupId;
			p.Hash = hashToken(p.ID, p.Value, p.Enabled);
			p.Origin = p.Origin || appOrigin;
			p.Offset = getUnixTime();
			p.VehicleRegistration = p.Value.vehicleDetails.regNo;
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

	async sendPaymentNotification(paymentInfo, documentInfo) {
		const params = this._paymentMessageParams(paymentInfo, documentInfo);
		try {
			const data = await sns.publish(params).promise();
			console.log('Results from sending message: ', JSON.stringify(data, null, 2));
		} catch (err) {
			console.log('Unable to send message. Error JSON:', JSON.stringify(err, null, 2));
		}
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
				resolve(penaltyDocItemContainer.Responses[this.penaltyDocTableName]);
			} catch (err) {
				reject(new Error(`Problem fetching penaltyDocuments: ${err}`));
			}
		});
	}

	_groupPenaltyDocsToPayments(penaltyDocs) {
		const penaltiesByType = this._groupPenaltiesByType(penaltyDocs);

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

	_disableIdInTableParams(tableName, id, newHash) {
		const params = {
			TableName: tableName,
			Key: {
				ID: id,
			},
			UpdateExpression: 'set #e = :e, #o = :o',
			ExpressionAttributeNames: { '#e': 'Enabled', '#o': 'Offset' },
			ExpressionAttributeValues: {
				':e': false,
				':o': Date.now() / 1000,
			},
		};

		if (newHash !== undefined) {
			params.UpdateExpression += ', #h = :h';
			params.ExpressionAttributeNames['#h'] = 'Hash';
			params.ExpressionAttributeValues[':h'] = newHash;
		}

		return params;
	}

	_createUpdatePenaltiesPutParameters(penalties, tableName, paymentStatus) {
		const putRequests = penalties.map((p) => {
			p.Value.paymentStatus = paymentStatus;
			p.Offset = Date.now() / 1000;
			return {
				PutRequest: { Item: p },
			};
		});
		return {
			RequestItems: {
				[tableName]: putRequests,
			},
		};
	}

	_groupPenaltiesByType(penaltyDocs) {
		const penaltiesByType = penaltyDocs.reduce((payments, doc) => {
			const { penaltyType } = doc.Value;
			if (Object.keys(payments).includes(penaltyType)) {
				payments[penaltyType].push(doc);
			}
			return payments;
		}, { FPN: [], IM: [], CDN: [] });
		return penaltiesByType;
	}

	_paymentMessageParams(paymentInfo, documentInfo) {
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
				refNo: paymentInfo.id,
				regNo: documentInfo.Value.vehicleDetails.regNo,
				type: paymentInfo.penaltyType,
				status: paymentInfo.paymentStatus,
				amount: Number(paymentInfo.paymentAmount),
			}),
			APNS_SANDBOX: JSON.stringify({
				aps,
				offset: documentInfo.Offset,
				site: documentInfo.Value.siteCode,
				refNo: paymentInfo.id,
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

	/**
	 * @param {String[]} ids
	 * @returns {Promise<PenaltyDocument[]>}
	 */
	async _getPenaltyDocumentsWithIds(ids) {
		const batchGetParams = {
			RequestItems: {
				[this.penaltyDocTableName]: {
					Keys: ids.map(id => ({
						ID: id,
					})),
				},
			},
		};
		const res = await this.db.batchGet(batchGetParams).promise();
		return res.Responses[this.penaltyDocTableName];
	}

	static sumPenaltyAmounts(penalties) {
		return penalties
			.map(p => p.Value.penaltyAmount)
			.reduce((acc, curr) => acc + curr);
	}

}
