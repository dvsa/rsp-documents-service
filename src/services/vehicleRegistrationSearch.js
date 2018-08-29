import createResponse from '../utils/createResponse';
import createErrorResponse from '../utils/createErrorResponse';
import onlyUnique from '../utils/onlyUnique';

export default class VehicleRegistrationSearch {
	constructor(db, penaltyDocTableName, penaltyGroupTableName) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
	}
	async search(vehicleReg, callback) {
		try {
			// Check in single penalties first
			const { Items } = await this._searchSinglePenalties(vehicleReg);
			console.log('single pen data');
			console.log(Items);
			if (Items.length > 0) {
				const Penalties = Items.filter((item) => {
					return typeof !item.inPenaltyGroup && !item.Value.inPenaltyGroup;
				});
				const penaltiesInGroups = Items.filter((item) => {
					return item.inPenaltyGroup || item.Value.inPenaltyGroup;
				});
				console.log('Penalties');
				console.log(Penalties);
				// If there are no penalties in groups, just return the penalties
				if (penaltiesInGroups.length < 1) {
					return callback(null, createResponse({
						statusCode: 200,
						body: { Penalties, PenaltyGroups: [] },
					}));
				}
				console.log('Getting penalty groups');
				// Otherwise, get the penalty groups
				const penaltyGroupIds = penaltiesInGroups.map(p => p.penaltyGroupId);
				this._batchGetPenaltyGroups(penaltyGroupIds)
					.then((data) => {
						const { Responses } = data;
						const PenaltyGroups = Responses[this.penaltyGroupTableName];
						console.log('pen group data');
						console.log(Responses);
						return callback(null, createResponse({
							statusCode: 200,
							body: { Penalties, PenaltyGroups },
						}));
					})
					.catch((err) => {
						console.log('_batchGetPenaltyGroups error');
						console.log(err);
						callback(null, createErrorResponse({ statusCode: 400, body: err }));
					});
			}
			// Return 404 not found
			return callback(null, createErrorResponse({ statusCode: 404, body: 'No penalties found' }));
		} catch (err) {
			return callback(null, createErrorResponse({ statusCode: 400, body: err }));
		}
	}
	_batchGetPenaltyGroups(ids) {
		const uniqueIds = ids.filter(onlyUnique);
		const batchGetRequestKeys = uniqueIds.map(id => ({
			ID: id,
		}));
		console.log(batchGetRequestKeys);
		console.log(typeof batchGetRequestKeys);
		const batchGetParams = {
			RequestItems: {
				[this.penaltyGroupTableName]: {
					Keys: batchGetRequestKeys,
				},
			},
		};
		console.log('batchGetParams');
		console.log(batchGetParams);
		return this.db.batchGet(batchGetParams).promise();
	}
	_searchSinglePenalties(vehicleReg) {
		const params = {
			TableName: this.penaltyDocTableName,
			FilterExpression: '#Value.#vehicleDetails.#regNo = :value',
			ExpressionAttributeNames: {
				'#Value': 'Value',
				'#vehicleDetails': 'vehicleDetails',
				'#regNo': 'regNo',
			},
			ExpressionAttributeValues: {
				':value': vehicleReg,
			},
		};
		return this.db.scan(params).promise();
	}
}
