import prisma from '../../config/db.js';

// ─── Admin Dashboard ───────────────────────────────────────────
const getAdminDashboard = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);

  const [
    totalLeads,
    newLeadsToday,
    convertedLeads,
    lostLeads,
    totalCustomers,
    totalBookings,
    confirmedBookings,
    pendingFollowUps,
    todayFollowUps,
    totalPayments,
    paidPayments,
    pendingPayments,
    recentLeads,
    topAgents,
    leadsByStatus,
    leadsBySource,
    bookingsByStatus,
    monthlyLeads,
    monthlyRevenue,
  ] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
    prisma.lead.count({
  where: {
    stage: {
  is: {
    title: 'CONVERTED'
  }
}
  }
}),

prisma.lead.count({
  where: {
    stage: { is: { title: 'LOST' } }
  }
}),
    prisma.customer.count(),
    prisma.booking.count(),
    prisma.booking.count({ where: { status: 'CONFIRMED' } }),
    prisma.followUp.count({ where: { status: 'PENDING' } }),
    prisma.followUp.count({ where: { status: 'PENDING', dueAt: { gte: today, lt: tomorrow } } }),
    prisma.payment.aggregate({ _sum: { amount: true, paidAmount: true } }),
    prisma.payment.aggregate({ where: { status: 'PAID' }, _sum: { paidAmount: true } }),
    prisma.payment.count({ where: { status: { in: ['UNPAID', 'PARTIALLY_PAID'] } } }),

    prisma.lead.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { assignedTo: { select: { id: true, name: true } } },
    }),

    prisma.user.findMany({
      where: { role: { in: ['AGENT', 'MANAGER'] }, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        role: true,
        _count: {
          select: {
            assignedLeads: {
  where: {
    stage: {
  is: {
    title: 'CONVERTED'
  }
}
  }
},
          },
        },
      },
      take: 5,
    }),

    prisma.lead.groupBy({
  by: ['stageId'],
  _count: { stageId: true }
}),
    prisma.lead.groupBy({ by: ['source'], _count: { source: true } }),
    prisma.booking.groupBy({ by: ['status'], _count: { status: true } }),

    Promise.all([
      prisma.lead.count({ where: { createdAt: { gte: thisMonthStart } } }),
      prisma.lead.count({ where: { createdAt: { gte: lastMonthStart, lt: lastMonthEnd } } }),
    ]),

    Promise.all([
      prisma.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: thisMonthStart } }, _sum: { paidAmount: true } }),
      prisma.payment.aggregate({ where: { status: 'PAID', paidAt: { gte: lastMonthStart, lt: lastMonthEnd } }, _sum: { paidAmount: true } }),
    ]),
  ]);

  return {
    stats: {
      leads: {
        total: totalLeads,
        newToday: newLeadsToday,
        converted: convertedLeads,
        lost: lostLeads,
        conversionRate: totalLeads > 0 ? ((convertedLeads / totalLeads) * 100).toFixed(1) : 0,
        thisMonth: monthlyLeads[0],
        lastMonth: monthlyLeads[1],
      },
      customers: { total: totalCustomers },
      bookings: {
        total: totalBookings,
        confirmed: confirmedBookings,
        byStatus: bookingsByStatus,
      },
      followUps: {
        pending: pendingFollowUps,
        dueToday: todayFollowUps,
      },
      payments: {
        totalAmount: totalPayments._sum.amount || 0,
        totalCollected: paidPayments._sum.paidAmount || 0,
        pendingCount: pendingPayments,
        thisMonthRevenue: monthlyRevenue[0]._sum.paidAmount || 0,
        lastMonthRevenue: monthlyRevenue[1]._sum.paidAmount || 0,
      },
    },
    charts: {
      leadsByStatus: leadsByStatus.map((l) => ({
  status: l.stageId,
  count: l._count.stageId
})),
      leadsBySource: leadsBySource.map((l) => ({ source: l.source, count: l._count.source })),
    },
    recentLeads,
    topAgents: topAgents
      .map((a) => ({ ...a, conversions: a._count.assignedLeads }))
      .sort((a, b) => b.conversions - a.conversions),
  };
};

// ─── Manager Dashboard ─────────────────────────────────────────
const getManagerDashboard = async (managerId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const teamAgents = await prisma.user.findMany({
    where: { role: 'AGENT', status: 'ACTIVE' },
    select: { id: true, name: true },
  });

  const agentIds = teamAgents.map((a) => a.id);

  const [
    teamLeads,
    teamConversions,
    pendingFollowUps,
    todayFollowUps,
    recentBookings,
    agentPerformance,
  ] = await Promise.all([
    prisma.lead.count({ where: { assignedToId: { in: agentIds } } }),
    prisma.lead.count({ where: { assignedToId: { in: agentIds }, stage: {
  is: {
    title: 'CONVERTED'
  }
} } }),
    prisma.followUp.count({ where: { assignedToId: { in: agentIds }, status: 'PENDING' } }),
    prisma.followUp.count({
      where: { assignedToId: { in: agentIds }, status: 'PENDING', dueAt: { gte: today, lt: tomorrow } },
    }),
    prisma.booking.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { id: true, name: true } } },
    }),
    Promise.all(
      teamAgents.map(async (agent) => ({
        agent,
        totalLeads: await prisma.lead.count({ where: { assignedToId: agent.id } }),
        converted: await prisma.lead.count({ where: { assignedToId: agent.id, stage: {
  is: {
    title: 'CONVERTED'
  }
} } }),
        pendingFollowUps: await prisma.followUp.count({ where: { assignedToId: agent.id, status: 'PENDING' } }),
      }))
    ),
  ]);

  return {
    stats: {
      teamLeads,
      teamConversions,
      conversionRate: teamLeads > 0 ? ((teamConversions / teamLeads) * 100).toFixed(1) : 0,
      pendingFollowUps,
      todayFollowUps,
    },
    recentBookings,
    agentPerformance,
  };
};

// ─── Agent Dashboard ───────────────────────────────────────────
const getAgentDashboard = async (agentId) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    myLeads,
    myConversions,
    myPendingFollowUps,
    myTodayFollowUps,
    recentLeads,
    upcomingFollowUps,
  ] = await Promise.all([
    prisma.lead.count({ where: { assignedToId: agentId } }),
    prisma.lead.count({ where: { assignedToId: agentId, stage: {
  is: {
    title: 'CONVERTED'
  }
} } }),
    prisma.followUp.count({ where: { assignedToId: agentId, status: 'PENDING' } }),
    prisma.followUp.count({
      where: { assignedToId: agentId, status: 'PENDING', dueAt: { gte: today, lt: tomorrow } },
    }),
    prisma.lead.findMany({
      where: { assignedToId: agentId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    }),
    prisma.followUp.findMany({
      where: { assignedToId: agentId, status: 'PENDING' },
      orderBy: { dueAt: 'asc' },
      take: 5,
      include: {
        lead: { select: { id: true, name: true, phone: true } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),
  ]);

  return {
    stats: {
      myLeads,
      myConversions,
      conversionRate: myLeads > 0 ? ((myConversions / myLeads) * 100).toFixed(1) : 0,
      myPendingFollowUps,
      myTodayFollowUps,
    },
    recentLeads,
    upcomingFollowUps,
  };
};

export {
  getAdminDashboard,
  getManagerDashboard,
  getAgentDashboard
};