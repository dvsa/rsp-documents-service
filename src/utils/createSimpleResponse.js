export default ({ body = {}, statusCode = 200, error }) => {
	const response = {
		status: statusCode,
		item: body,
		error,
	};
	return response;
};
