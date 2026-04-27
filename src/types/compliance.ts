export type Classifier = 'INCOME_CLAIM' | 'TESTIMONIAL' | 'OPPORTUNITY' | 'INSURANCE' | 'REFERRAL';

export interface CFEInput {
  content: string;
  channel: 'SMS' | 'EMAIL' | 'SOCIAL' | 'PHONE';
  userContext: {
    user_id: string;
    role: 'REP' | 'UPLINE' | 'ADMIN' | 'DUAL' | 'RVP' | 'EXTERNAL';
  };
}

export interface CFEResult {
  outcome: 'PASS' | 'FLAG' | 'BLOCK';
  risk_score: number;
  classifier_data: Record<Classifier, number>;
}
