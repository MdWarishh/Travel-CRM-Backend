import prisma from '../../config/db.js';
import { AppError, getPagination, buildPaginationMeta } from '../../utils/helpers.js';

// ─────────────────────────────────────────────
// INCLUDE SHAPE  (reused across queries)
// ─────────────────────────────────────────────

const itineraryInclude = {
  customer: { select: { id: true, name: true, phone: true, email: true } },
  createdBy: { select: { id: true, name: true } },
  days: {
    orderBy: { dayNumber: 'asc' },
    include: {
      images: { orderBy: { position: 'asc' } },
    },
  },
  theme: true,
  policies: true,
  accounts: { orderBy: { isDefault: 'desc' } },
  thankYou: true,
};

// ─────────────────────────────────────────────
// LIST
// ─────────────────────────────────────────────

export const getAllItineraries = async (
  { page, limit, status, customerId, search, isTemplate },
  requestingUser
) => {
  const { skip, take, page: pageNum, limit: limitNum } = getPagination(page, limit);

  const where = {
    ...(status && { status }),
    ...(customerId && { customerId }),
    ...(isTemplate !== undefined && { isTemplate: isTemplate === 'true' }),
    ...(requestingUser.role === 'AGENT' && {
      OR: [
        { createdById: requestingUser.id },
        { customer: { assignedToId: requestingUser.id } },
      ],
    }),
    ...(search && {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { destination: { contains: search, mode: 'insensitive' } },
      ],
    }),
  };

  const [itineraries, total] = await Promise.all([
    prisma.itinerary.findMany({
      where,
      include: itineraryInclude,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.itinerary.count({ where }),
  ]);

  return { itineraries, pagination: buildPaginationMeta(total, pageNum, limitNum) };
};

// ─────────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────────

export const getItineraryById = async (id) => {
  const itinerary = await prisma.itinerary.findUnique({
    where: { id },
    include: itineraryInclude,
  });
  if (!itinerary) throw new AppError('Itinerary not found', 404);
  return itinerary;
};

// ─────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────

export const createItinerary = async (data, requestingUser) => {
  const { days, theme, policies, accounts, thankYou, ...itineraryData } = data;

  // Validate customer if provided
  if (itineraryData.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: itineraryData.customerId } });
    if (!customer) throw new AppError('Customer not found', 404);
  }

  const itinerary = await prisma.itinerary.create({
    data: {
      ...itineraryData,
      createdById: requestingUser.id,

      // Days + images (nested)
      ...(days?.length && {
        days: {
          create: days.map(({ images, ...day }) => ({
            ...day,
            ...(images?.length && {
              images: { create: images },
            }),
          })),
        },
      }),

      // Theme
      ...(theme && { theme: { create: theme } }),

      // Policies
      ...(policies && { policies: { create: policies } }),

      // Accounts
      ...(accounts?.length && {
        accounts: { create: accounts },
      }),

      // Thank you
      ...(thankYou && { thankYou: { create: thankYou } }),
    },
    include: itineraryInclude,
  });

  return itinerary;
};

// ─────────────────────────────────────────────
// UPDATE (top-level fields only; days/images
// managed via dedicated endpoints)
// ─────────────────────────────────────────────

export const updateItinerary = async (id, data) => {
  await getItineraryById(id); // 404 guard
  const { days, theme, policies, accounts, thankYou, ...itineraryData } = data;

  await prisma.itinerary.update({
    where: { id },
    data: {
      ...itineraryData,

      // Upsert theme
      ...(theme && {
        theme: {
          upsert: { create: theme, update: theme },
        },
      }),

      // Upsert policies
      ...(policies && {
        policies: {
          upsert: { create: policies, update: policies },
        },
      }),

      // Upsert thankYou
      ...(thankYou && {
        thankYou: {
          upsert: { create: thankYou, update: thankYou },
        },
      }),

      // Replace accounts if provided
      ...(accounts && {
        accounts: {
          deleteMany: {},
          create: accounts,
        },
      }),
    },
  });

  // If days provided, upsert each
  if (days?.length) {
    for (const day of days) {
      await upsertDay(id, day);
    }
  }

  return getItineraryById(id);
};

// ─────────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────────

export const deleteItinerary = async (id) => {
  await getItineraryById(id);
  await prisma.itinerary.delete({ where: { id } });
  return true;
};

// ─────────────────────────────────────────────
// UPSERT DAY
// ─────────────────────────────────────────────

export const upsertDay = async (itineraryId, dayData) => {
  await getItineraryById(itineraryId); // 404 guard

  const { images, ...dayFields } = dayData;

  const existing = await prisma.itineraryDay.findFirst({
    where: { itineraryId, dayNumber: dayFields.dayNumber },
  });

  let day;

  if (existing) {
    day = await prisma.itineraryDay.update({
      where: { id: existing.id },
      data: dayFields,
    });
  } else {
    day = await prisma.itineraryDay.create({
      data: { ...dayFields, itineraryId },
    });
  }

  // Replace images for this day if provided
  if (images !== undefined) {
    await prisma.itineraryImage.deleteMany({ where: { dayId: day.id } });
    if (images.length) {
      await prisma.itineraryImage.createMany({
        data: images.map((img, i) => ({ ...img, dayId: day.id, position: img.position ?? i })),
      });
    }
  }

  return prisma.itineraryDay.findUnique({
    where: { id: day.id },
    include: { images: { orderBy: { position: 'asc' } } },
  });
};

// ─────────────────────────────────────────────
// DELETE DAY
// ─────────────────────────────────────────────

export const deleteDay = async (itineraryId, dayId) => {
  const day = await prisma.itineraryDay.findFirst({ where: { id: dayId, itineraryId } });
  if (!day) throw new AppError('Day not found', 404);
  await prisma.itineraryDay.delete({ where: { id: dayId } });
  return true;
};

// ─────────────────────────────────────────────
// DUPLICATE
// ─────────────────────────────────────────────

export const duplicateItinerary = async (id, customerId, requestingUser) => {
  const original = await getItineraryById(id);

  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new AppError('Customer not found', 404);
  }

  const { theme, policies, accounts, thankYou } = original;

  const duplicate = await prisma.itinerary.create({
    data: {
      title: `${original.title} (Copy)`,
      customerId: customerId || original.customerId,
      createdById: requestingUser.id,
      status: 'DRAFT',
      isTemplate: original.isTemplate,
      startDate: original.startDate,
      endDate: original.endDate,
      totalDays: original.totalDays,
      destination: original.destination,
      startPoint: original.startPoint,
      endPoint: original.endPoint,
      durationLabel: original.durationLabel,
      totalPrice: original.totalPrice,
      numberOfTravelers: original.numberOfTravelers,
      heroImageUrl: original.heroImageUrl,
      inclusions: original.inclusions,
      exclusions: original.exclusions,
      notes: original.notes,

      days: {
        create: original.days.map(({ id: _id, itineraryId: _iid, createdAt: _ca, updatedAt: _ua, images, ...day }) => ({
          ...day,
          images: {
            create: images.map(({ id: _imgId, dayId: _did, createdAt: _ic, ...img }) => img),
          },
        })),
      },

      ...(theme && {
        theme: {
          create: {
            primaryColor: theme.primaryColor,
            backgroundColor: theme.backgroundColor,
            textColor: theme.textColor,
            accentColor: theme.accentColor,
            fontFamily: theme.fontFamily,
          },
        },
      }),

      ...(policies && {
        policies: {
          create: {
            bookingPolicy: policies.bookingPolicy,
            cancellationPolicy: policies.cancellationPolicy,
            paymentTerms: policies.paymentTerms,
            otherPolicies: policies.otherPolicies,
          },
        },
      }),

      ...(accounts?.length && {
        accounts: {
          create: accounts.map(({ id: _id, itineraryId: _iid, createdAt: _ca, ...acc }) => acc),
        },
      }),

      ...(thankYou && {
        thankYou: {
          create: {
            message: thankYou.message,
            backgroundImageUrl: thankYou.backgroundImageUrl,
            companyName: thankYou.companyName,
            companyAddress: thankYou.companyAddress,
            companyEmail: thankYou.companyEmail,
            companyPhone: thankYou.companyPhone,
            companyWebsite: thankYou.companyWebsite,
            findUsText: thankYou.findUsText,
          },
        },
      }),
    },
    include: itineraryInclude,
  });

  return duplicate;
};

// ─────────────────────────────────────────────
// UPDATE STATUS
// ─────────────────────────────────────────────

export const updateStatus = async (id, status) => {
  await getItineraryById(id);
  return prisma.itinerary.update({
    where: { id },
    data: { status },
    include: itineraryInclude,
  });
};