export default ({ body = {}, statusCode = 200, error = undefined }) => {
	const response = {
		status: statusCode,
		item: body,
		error,
	};
	console.log(response);
	return response;
};
