export default ({ items = [], payments = [] }) => {

	payments.forEach((payment) => {
		const foundIndex = items.findIndex((item) => {
			return item.ID === payment.ID;
		});

		if (foundIndex) {
			items[foundIndex].Value.paymentStatus = payment.Status;
			items[foundIndex].Value.paymentAuthCode = payment.Payment.AuthCode;
			items[foundIndex].Value.paymentDate = payment.Payment.AuthCode;
		}
	});

	return items;
};
