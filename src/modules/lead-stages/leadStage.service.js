import prisma from '../../config/db.js';
import { AppError } from '../../utils/helpers.js';

export const getAllStages = async () => {
  return prisma.leadStage.findMany({
    orderBy: { position: 'asc' },
    include: { _count: { select: { leads: true } } },
  });
};

export const createStage = async ({ title, color, position, isWon = false }) => {
  if (position === undefined || position === null) {
    const last = await prisma.leadStage.findFirst({ orderBy: { position: 'desc' } });
    position = last ? last.position + 1 : 0;
  }

  // Agar ye Won stage hai to pehle baaki sab Won stages unset karo (ek waqt sirf ek Won stage)
  if (isWon) {
    await prisma.leadStage.updateMany({ where: { isWon: true }, data: { isWon: false } });
  }

  return prisma.leadStage.create({ data: { title, color, position, isWon } });
};

export const updateStage = async (id, { title, color, position, isWon }) => {
  const stage = await prisma.leadStage.findUnique({ where: { id } });
  if (!stage) throw new AppError('Stage not found', 404);

  // Agar is stage ko Won banana hai to pehle baaki sab Won stages unset karo
  if (isWon === true) {
    await prisma.leadStage.updateMany({
      where: { isWon: true, id: { not: id } },
      data: { isWon: false },
    });
  }

  return prisma.leadStage.update({
    where: { id },
    data: {
      ...(title !== undefined               && { title }),
      ...(color !== undefined               && { color }),
      ...(position !== undefined            && { position }),
      ...(isWon !== undefined               && { isWon }),
    },
  });
};

export const deleteStage = async (id) => {
  const stage = await prisma.leadStage.findUnique({
    where: { id },
    include: { _count: { select: { leads: true } } },
  });
  if (!stage) throw new AppError('Stage not found', 404);
  if (stage._count.leads > 0)
    throw new AppError(`Cannot delete: ${stage._count.leads} leads are in this stage. Move them first.`, 400);

  return prisma.leadStage.delete({ where: { id } });
};

export const reorderStages = async (orderedIds) => {
  const updates = orderedIds.map((id, index) =>
    prisma.leadStage.update({ where: { id }, data: { position: index } })
  );
  await prisma.$transaction(updates);
  return prisma.leadStage.findMany({ orderBy: { position: 'asc' } });
};