import createResponse from '../utils/createResponse';
import onlyUnique from '../utils/onlyUnique';
import HttpStatus from '../utils/httpStatusCode';
import { logInfo, logError } from '../utils/logger';

export default class VehicleRegistrationSearch {
	constructor(db, penaltyDocTableName, penaltyGroupTableName) {
		this.db = db;
		this.penaltyDocTableName = penaltyDocTableName;
		this.penaltyGroupTableName = penaltyGroupTableName;
	}

	async search(vehicleReg) {
		try {
			// Check in single penalties first
			const { Items } = await this._searchSinglePenalties(vehicleReg);
			if (Items.length > 0) {
				const Penalties = Items.filter((item) => {
					return typeof !item.inPenaltyGroup && !item.Value.inPenaltyGroup;
				});
				const penaltiesInGroups = Items.filter((item) => {
					return item.inPenaltyGroup || item.Value.inPenaltyGroup;
				});
				// If there are no penalties in groups, just return the penalties
				if (penaltiesInGroups.length < 1) {
					return createResponse({
						statusCode: HttpStatus.OK,
						body: { Penalties, PenaltyGroups: [] },
					});
				}
				// Otherwise, get the penalty groups
				const penaltyGroupIds = penaltiesInGroups.map((p) => p.penaltyGroupId);
				const { Responses } = await this._batchGetPenaltyGroups(penaltyGroupIds);
				const PenaltyGroups = Responses[this.penaltyGroupTableName];
				return createResponse({
					statusCode: HttpStatus.OK,
					body: { Penalties, PenaltyGroups },
				});
			}
			// Return 404 not found
			logInfo('VehicleRegNotFound', {
				vehicleReg,
				message: `No penalties found for registration ${vehicleReg}`,
			});
			return createResponse({ statusCode: HttpStatus.NOT_FOUND, body: 'No penalties found' });
		} catch (err) {
			logError('VehicleRegSearchError', {
				vehicleReg,
				error: err.message,
			});
			return createResponse({ statusCode: HttpStatus.BAD_REQUEST, body: err });
		}
	}

	_batchGetPenaltyGroups(ids) {
		const uniqueIds = ids.filter(onlyUnique);
		const batchGetRequestKeys = uniqueIds.map((id) => ({
			ID: id,
		}));
		const batchGetParams = {
			RequestItems: {
				[this.penaltyGroupTableName]: {
					Keys: batchGetRequestKeys,
				},
			},
		};
		return this.db.batchGet(batchGetParams).promise();
	}

	_searchSinglePenalties(vehicleReg) {
		const params = {
			TableName: this.penaltyDocTableName,
			IndexName: 'ByVehicleRegistration',
			KeyConditionExpression: '#VehicleRegistration = :vehicleRegistration',
			ExpressionAttributeNames: { '#VehicleRegistration': 'VehicleRegistration' },
			ExpressionAttributeValues: { ':vehicleRegistration': vehicleReg },
		};
		return this.db.query(params).promise();
	}
}
