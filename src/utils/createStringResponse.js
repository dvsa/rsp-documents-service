export default ({ body = {}, statusCode = 200 }) => {
	const response = {
		statusCode,
		headers: {
			'Access-Control-Allow-Origin': '*', // Required for CORS support to work
			'Content-Type': 'application/json',
		},
		body,
	};
	return response;
};
