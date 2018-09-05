export default ({ item, payment }) => {

	item.Value.paymentStatus = payment.PenaltyStatus;
	item.Value.paymentAuthCode = payment.PaymentDetail.AuthCode;
	item.Value.paymentDate = payment.PaymentDetail.PaymentDate;
	return item;
};
