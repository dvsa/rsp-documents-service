import { doc } from 'serverless-dynamodb-client';
import VehicleRegistrationSearch from '../services/vehicleRegistrationSearch';
import config from '../config';
import { logInfo } from '../utils/logger';

let vehicleRegistrationSearch;
export const handler = async (event) => {
	if (!vehicleRegistrationSearch) {
		await config.bootstrap();
		vehicleRegistrationSearch = new VehicleRegistrationSearch(
			doc,
			config.dynamodbPenaltyDocTable(),
			config.dynamodbPenaltyGroupTable(),
		);
	}
	logInfo('searchByVehicleRegistrationReq', event.pathParameters.vehicleReg);
	const resp = vehicleRegistrationSearch.search(decodeURI(event.pathParameters.vehicleReg));
	logInfo('searchByVehicleRegistrationRes', resp);
	return resp;
};

export default handler;
