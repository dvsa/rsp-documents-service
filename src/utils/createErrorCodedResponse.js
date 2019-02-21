/**
 * Create and log a new error response.
 * @param {number} httpStatusCode The http response code
 * @param {string} errorCode A unique short error code
 * @param {*} errMessage A JSON object containing the error details
 */
const createErrorCodedResponse = (httpStatusCode, errorCode, errMessage = {}) => {
	const response = {
		statusCode: httpStatusCode,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ errorCode, details: errMessage }),
	};
	console.log(response);
	return response;
};

export default createErrorCodedResponse;
