export default ({ body = {}, statusCode = 200, error }) => {
	const response = {
		status: statusCode,
		item: body,
		error,
	};

	console.log('createSimpleResponse');
	console.log(JSON.stringify(response, null, 2));
	console.log(`error : ${error}`);
	return response;
};
