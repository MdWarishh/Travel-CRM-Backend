import prisma from '../../config/db.js';

const getLeadReport = async ({ from, to, source, assignedToId }) => {
  const where = {
    ...(from && to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
    ...(source && { source }),
    ...(assignedToId && { assignedToId }),
  };

  const [total, byStatus, bySource, byPriority, byAgent] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.groupBy({ by: ['stageId'], where, _count: { stageId: true } }),
    prisma.lead.groupBy({ by: ['source'], where, _count: { source: true } }),
    prisma.lead.groupBy({ by: ['priority'], where, _count: { priority: true } }),
    prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { ...where, assignedToId: { not: null } },
      _count: { assignedToId: true },
    }),
  ]);

  const agentIds = byAgent.map((a) => a.assignedToId).filter(Boolean);
  const agents = await prisma.user.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true },
  });
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  return {
    total,
    byStatus: byStatus.map((s) => ({ stageId: s.stageId, count: s._count.stageId })),
    bySource: bySource.map((s) => ({ source: s.source, count: s._count.source })),
    byPriority: byPriority.map((s) => ({ priority: s.priority, count: s._count.priority })),
    byAgent: byAgent.map((a) => ({
      agentId: a.assignedToId,
      agentName: agentMap[a.assignedToId] || 'Unknown',
      count: a._count.assignedToId,
    })),
  };
};

const getConversionReport = async ({ from, to }) => {
  const where = {
    ...(from && to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
  };

  const [total, converted, lost, byAgentRaw] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { ...where, stage: { is: { title: 'CONVERTED' } } } }),
    prisma.lead.count({ where: { ...where, stage: { is: { title: 'LOST' } } } }),
    prisma.lead.groupBy({
      by: ['assignedToId'],
      where: { ...where, assignedToId: { not: null } },
      _count: { assignedToId: true },
    }),
  ]);

  const agentIds = [...new Set(byAgentRaw.map((a) => a.assignedToId).filter(Boolean))];
  const agents = await prisma.user.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true },
  });
  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a.name]));

  const agentStatsArr = await Promise.all(
    agentIds.map(async (agentId) => {
      const [agentConverted, agentLost] = await Promise.all([
        prisma.lead.count({ where: { ...where, assignedToId: agentId, stage: { is: { title: 'CONVERTED' } } } }),
        prisma.lead.count({ where: { ...where, assignedToId: agentId, stage: { is: { title: 'LOST' } } } }),
      ]);
      return { agentId, agentName: agentMap[agentId] || 'Unknown', converted: agentConverted, lost: agentLost };
    })
  );
  const agentStats = Object.fromEntries(agentStatsArr.map((a) => [a.agentId, a]));

  return {
    total,
    converted,
    lost,
    conversionRate: total > 0 ? ((converted / total) * 100).toFixed(2) : 0,
    byAgent: Object.values(agentStats),
  };
};

const getBookingReport = async ({ from, to, status }) => {
  const where = {
    ...(from && to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
    ...(status && { status }),
  };

  const [total, byStatus, bookings] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.groupBy({ by: ['status'], where, _count: { status: true } }),
    prisma.booking.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        itinerary: { select: { id: true, title: true, destination: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const totalRevenue = await prisma.payment.aggregate({
    where: {
      booking: where,
      status: 'PAID',
    },
    _sum: { paidAmount: true },
  });

  return {
    total,
    byStatus: byStatus.map((b) => ({ status: b.status, count: b._count.status })),
    totalRevenue: totalRevenue._sum.paidAmount || 0,
    bookings,
  };
};

const getPaymentReport = async ({ from, to, mode, status }) => {
  const where = {
    ...(from && to && { createdAt: { gte: new Date(from), lte: new Date(to) } }),
    ...(mode && { mode }),
    ...(status && { status }),
  };

  const [total, byStatus, byMode, aggregate] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ['status'], where, _count: true, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ['mode'], where, _count: true, _sum: { paidAmount: true } }),
    prisma.payment.aggregate({ where, _sum: { amount: true, paidAmount: true, dueAmount: true } }),
  ]);

  return {
    total,
    totalAmount: aggregate._sum.amount || 0,
    totalCollected: aggregate._sum.paidAmount || 0,
    totalDue: aggregate._sum.dueAmount || 0,
    byStatus: byStatus.map((p) => ({ status: p.status, count: p._count, amount: p._sum.amount })),
    byMode: byMode.map((p) => ({ mode: p.mode, count: p._count, collected: p._sum.paidAmount })),
  };
};

const getAgentPerformanceReport = async ({ from, to }) => {
  const where = from && to ? { createdAt: { gte: new Date(from), lte: new Date(to) } } : {};

  const agents = await prisma.user.findMany({
    where: { role: { in: ['AGENT', 'MANAGER'] }, status: 'ACTIVE' },
    select: { id: true, name: true, role: true, email: true },
  });

  const performance = await Promise.all(
    agents.map(async (agent) => {
      const [totalLeads, converted, lost, pendingFollowUps, completedFollowUps] = await Promise.all([
        prisma.lead.count({ where: { assignedToId: agent.id, ...where } }),
        prisma.lead.count({ where: { assignedToId: agent.id, stage: { is: { title: 'CONVERTED' } }, ...where } }),
        prisma.lead.count({ where: { assignedToId: agent.id, stage: { is: { title: 'LOST' } }, ...where } }),
        prisma.followUp.count({ where: { assignedToId: agent.id, status: 'PENDING' } }),
        prisma.followUp.count({ where: { assignedToId: agent.id, status: 'COMPLETED', ...where } }),
      ]);

      return {
        ...agent,
        totalLeads,
        converted,
        lost,
        pendingFollowUps,
        completedFollowUps,
        conversionRate: totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : 0,
      };
    })
  );

  return performance.sort((a, b) => b.converted - a.converted);
};

export {
  getLeadReport,
  getConversionReport,
  getBookingReport,
  getPaymentReport,
  getAgentPerformanceReport
};