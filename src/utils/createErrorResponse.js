import HttpStatus from './httpStatusCode';

export default ({ statusCode, err }) => {
	const response = {
		statusCode,
		headers: {
			'Access-Control-Allow-Origin': '*', // Required for CORS support to work
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ name: err.name, message: err.message }),
	};
	if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
		console.log({ statusCode, errorMessage: err.message });
	}
	return response;
};
