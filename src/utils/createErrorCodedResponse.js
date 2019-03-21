/**
 * Create and log a new error response.
 * @param {number} httpStatusCode The http response code
 * @param {string} errCode A unique short error code
 * @param {string} errMessage A human-readable error message
 * @param {*} errMessage A JSON object containing the error details/data
 */
const createErrorCodedResponse = (httpStatusCode, errCode, errMessage, errBody = {}) => {
	const response = {
		statusCode: httpStatusCode,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ errCode, errMessage, errBody }),
	};
	console.log(response);
	return response;
};

export default createErrorCodedResponse;
