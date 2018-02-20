export default ({ statusCode = 200, body = {} }) => {
	const response = {
		statusCode,
		headers: {
			'Access-Control-Allow-Origin': '*', // Required for CORS support to work
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	};
	return response;
};
