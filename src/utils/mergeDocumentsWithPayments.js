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
			newArray[foundIndex].Value.paymentRef = payment.PaymentDetail.PaymentRef;
			newArray[foundIndex].Value.paymentMethod = payment.PaymentDetail.PaymentMethod;
		}
	});
	// postprocess array to mark unpaid items
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
