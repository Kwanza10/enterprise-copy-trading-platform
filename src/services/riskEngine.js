function evaluateRisk(strategy, allocation) {
  const score = {
    low: 1,
    moderate: 2,
    high: 3,
    extreme: 4
  };

  const strategyScore = score[strategy.riskLevel] || 2;
  const allocationScore = score[allocation.riskTolerance] || 2;

  const total = strategyScore + allocationScore;

  if (total >= 6) {
    return {
      level: 'high',
      approved: false,
      reason: 'Portfolio exceeds risk guardrails'
    };
  }

  return {
    level: 'ok',
    approved: true,
    reason: 'Allocation within configured limits'
  };
}

module.exports = { evaluateRisk };
