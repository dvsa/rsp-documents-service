import { doc } from 'serverless-dynamodb-client';
import VehicleRegistrationSearch from '../services/vehicleRegistrationSearch';

const vehicleRegistrationSearch = new VehicleRegistrationSearch(
	doc,
	process.env.DYNAMODB_PENALTY_DOC_TABLE,
	process.env.DYNAMODB_PENALTY_GROUP_TABLE,
);

export default (event, context, callback) => {
	vehicleRegistrationSearch.search(decodeURI(event.pathParameters.vehicleReg), callback);
};
