
export default (tokenObject, id, tokenString, penaltyType, paymentInfo) => {
	if (!paymentInfo.paymentAuthCode) {
		return {
			ID: id,
			Value: {
				penaltyType,
				paymentStatus: paymentInfo.paymentStatus,
				paymentToken: tokenString,
				referenceNo: tokenObject.Reference,
				penaltyAmount: tokenObject.PaymentAmount,
			},
		};
	}
	return {
		ID: id,
		Value: {
			penaltyType,
			paymentStatus: paymentInfo.paymentStatus,
			paymentAuthCode: paymentInfo.paymentAuthCode,
			paymentDate: paymentInfo.paymentDate,
			paymentToken: tokenString,
			referenceNo: tokenObject.Reference,
			penaltyAmount: tokenObject.PaymentAmount,
		},
	};
};

