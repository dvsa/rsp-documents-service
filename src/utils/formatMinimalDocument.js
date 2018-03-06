
export default (tokenObject, id, tokenString, penaltyType, paymentInfo) => {
	if (!paymentInfo.paymentAuthCode) {
		return {
			ID: id,
			Value: {
				PenaltyType: penaltyType,
				PaymentStatus: paymentInfo.paymentStatus,
				PaymentToken: tokenString,
				ReferenceNo: tokenObject.Reference,
				PenaltyAmount: tokenObject.PaymentAmount,
			},
		};
	}
	return {
		ID: id,
		Value: {
			PenaltyType: penaltyType,
			PaymentStatus: paymentInfo.paymentStatus,
			PaymentAuthCode: paymentInfo.paymentAuthCode,
			PaymentDate: paymentInfo.paymentDate,
			PaymentToken: tokenString,
			ReferenceNo: tokenObject.Reference,
			PenaltyAmount: tokenObject.PaymentAmount,
		},
	};
};

