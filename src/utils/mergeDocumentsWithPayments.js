export default ({ items = [], payments = [] }) => {

	const newArray = items.slice();
	payments.forEach((payment) => {
		const foundIndex = newArray.findIndex((item) => {
			return item.ID === payment.ID;
		});
		if (foundIndex || foundIndex === 0) {
			newArray[foundIndex].Value.paymentStatus = payment.PenaltyStatus;
			newArray[foundIndex].Value.paymentAuthCode = payment.PaymentDetail.AuthCode;
			newArray[foundIndex].Value.paymentDate = payment.PaymentDetail.PaymentDate;
		}
	});
	// postprocess array to mark unpaid itemms
	newArray.forEach((item) => {
		const foundIndex = payments.findIndex((payment) => {
			return item.ID === payment.ID;
		});
		if (foundIndex === -1) {
			item.Value.paymentStatus = 'UNPAID';
		}
	});
	return newArray;
};
