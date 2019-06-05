export default ({ statusCode, err }) => {
	const response = {
		statusCode,
		headers: {
			'Access-Control-Allow-Origin': '*', // Required for CORS support to work
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ name: err.name, message: err.message }),
	};
	return response;
};
