export default (date, days) => {
	return (new Date(
		date.getFullYear(),
		date.getMonth(),
		date.getDate() - days,
		0,
		0,
		0,
		0,
	).getTime() / 1000.0);
};
