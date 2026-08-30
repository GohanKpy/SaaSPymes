import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEFAULT_MAX_PHOTOS_PER_SERVICE,
  DEFAULT_MAX_PHOTO_BYTES,
  catalogImport,
  categoryCreate,
  categoryUpdate,
  serviceCreate,
  servicePhotoCreate,
  serviceUpdate,
  uuid,
  type CatalogImport,
  type CategoryCreate,
  type CategoryUpdate,
  type ServiceCreate,
  type ServicePhotoCreate,
  type ServiceUpdate,
} from '@pymes/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RequireFeature, type AuthRequest } from '../auth/decorators';
import { tenantCtx } from '../common/tenant-ctx';
import { ZodPipe } from '../common/zod.pipe';
import { AppPrisma } from '../prisma/app-prisma.service';
import { CatalogImportService } from './catalog-import.service';

@Controller('catalog')
@RequireFeature('catalog')
export class CatalogController {
  constructor(
    private readonly appDb: AppPrisma,
    private readonly importer: CatalogImportService,
  ) {}

  // ------------------- carga masiva por CSV (2026-08-30) -------------------

  /** Plantilla CSV armada con las categorias del negocio (crearlas primero). */
  @Get('import/template')
  async importTemplate(@Req() req: FastifyRequest & AuthRequest, @Res() reply: FastifyReply) {
    const { csv, filename } = await this.importer.template(tenantCtx(req));
    await reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${filename}"`)
      .send(csv);
  }

  /** Importacion masiva: dry_run = vista previa con errores por fila. */
  @Post('import')
  importCsv(
    @Body(new ZodPipe(catalogImport)) dto: CatalogImport,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.importer.import(tenantCtx(req), dto);
  }

  // ------------------------------ categorias -------------------------------

  @Get('categories')
  listCategories(@Req() req: FastifyRequest & AuthRequest) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.serviceCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
    );
  }

  @Post('categories')
  createCategory(
    @Body(new ZodPipe(categoryCreate)) dto: CategoryCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, (tx) =>
      tx.serviceCategory.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          sortOrder: dto.sort_order,
          defaultKind: dto.default_kind,
        },
      }),
    );
  }

  @Patch('categories/:id')
  patchCategory(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(categoryUpdate)) dto: CategoryUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.serviceCategory.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      return tx.serviceCategory.update({
        where: { id },
        data: { name: dto.name, sortOrder: dto.sort_order, defaultKind: dto.default_kind },
      });
    });
  }

  @Delete('categories/:id')
  @HttpCode(204)
  async removeCategory(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.serviceCategory.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      const active = await tx.service.count({ where: { categoryId: id, deletedAt: null } });
      if (active > 0) throw new ConflictException({ title: 'La categoria tiene servicios activos' });
      await tx.serviceCategory.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  // ------------------------------- servicios -------------------------------

  @Get('services')
  listServices(@Req() req: FastifyRequest & AuthRequest) {
    return this.appDb.tx(tenantCtx(req), (tx) =>
      tx.service.findMany({
        where: { deletedAt: null },
        include: {
          category: { select: { name: true } },
          // Solo ids para las miniaturas: los bytes se sirven por foto.
          photos: { select: { id: true, sort: true }, orderBy: { sort: 'asc' } },
        },
        orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
      }),
    );
  }

  @Post('services')
  createService(
    @Body(new ZodPipe(serviceCreate)) dto: ServiceCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const category = await tx.serviceCategory.findFirst({
        where: { id: dto.category_id, deletedAt: null },
      });
      if (!category) throw new NotFoundException({ title: 'Categoria inexistente' });
      // El tipo vive en el producto; la categoria solo presta su default.
      const kind = dto.kind ?? category.defaultKind;
      return tx.service.create({
        data: {
          tenantId: ctx.tenantId,
          categoryId: dto.category_id,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
          taxRate: dto.tax_rate,
          isActive: dto.is_active,
          kind,
          durationMin: kind === 'servicio' ? dto.duration_min : null,
          requiresMeeting: kind === 'item' ? (dto.requires_meeting ?? true) : false,
          meetingMin: kind === 'item' ? dto.meeting_min : null,
        },
      });
    });
  }

  @Patch('services/:id')
  patchService(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Body(new ZodPipe(serviceUpdate)) dto: ServiceUpdate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    return this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.service.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      // Normalizacion por tipo sobre el estado FINAL: un servicio no arrastra
      // datos de reunion y un item no tiene duracion de tarea.
      const kind = dto.kind ?? existing.kind;
      const durationMin = dto.duration_min !== undefined ? dto.duration_min : existing.durationMin;
      const requiresMeeting =
        dto.requires_meeting !== undefined ? dto.requires_meeting : existing.requiresMeeting;
      const meetingMin = dto.meeting_min !== undefined ? dto.meeting_min : existing.meetingMin;
      return tx.service.update({
        where: { id },
        data: {
          categoryId: dto.category_id,
          name: dto.name,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
          taxRate: dto.tax_rate,
          isActive: dto.is_active,
          kind,
          durationMin: kind === 'servicio' ? durationMin : null,
          requiresMeeting: kind === 'item' ? requiresMeeting : false,
          meetingMin: kind === 'item' ? meetingMin : null,
        },
      });
    });
  }

  // ---------------------- fotos de catalogo (P1) ----------------------

  /** Sube una foto (data URL, mismo camino que el logo del negocio). */
  @Post('services/:id/photos')
  addPhoto(
    @Param('id', new ZodPipe(uuid)) serviceId: string,
    @Body(new ZodPipe(servicePhotoCreate)) dto: ServicePhotoCreate,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    const ctx = tenantCtx(req);
    return this.appDb.tx(ctx, async (tx) => {
      const service = await tx.service.findFirst({ where: { id: serviceId, deletedAt: null } });
      if (!service) throw new NotFoundException();
      const count = await tx.servicePhoto.count({ where: { serviceId } });
      if (count >= DEFAULT_MAX_PHOTOS_PER_SERVICE) {
        throw new ConflictException({
          title: `Maximo ${DEFAULT_MAX_PHOTOS_PER_SERVICE} fotos por producto: borra alguna primero`,
        });
      }
      const [meta, base64] = dto.data.split(',', 2);
      const mime = /^data:(image\/(?:png|jpeg|webp));base64$/.exec(meta ?? '')?.[1];
      const bytes = Buffer.from(base64 ?? '', 'base64');
      if (!mime || bytes.length === 0) throw new UnprocessableEntityException({ title: 'Imagen invalida' });
      if (bytes.length > DEFAULT_MAX_PHOTO_BYTES) {
        throw new UnprocessableEntityException({
          title: `La foto supera ${Math.round(DEFAULT_MAX_PHOTO_BYTES / 1024)} KB: usa una version reducida`,
        });
      }
      const created = await tx.servicePhoto.create({
        data: {
          tenantId: ctx.tenantId,
          serviceId,
          mime,
          sizeBytes: bytes.length,
          data: bytes,
          sort: dto.sort,
        },
        select: { id: true, mime: true, sizeBytes: true, sort: true, createdAt: true },
      });
      return created;
    });
  }

  /** Bytes de una foto; el id es inmutable, el navegador puede cachear. */
  @Get('services/:id/photos/:photoId')
  async getPhoto(
    @Param('id', new ZodPipe(uuid)) serviceId: string,
    @Param('photoId', new ZodPipe(uuid)) photoId: string,
    @Req() req: FastifyRequest & AuthRequest,
    @Res() reply: FastifyReply,
  ) {
    const photo = await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.servicePhoto.findFirst({ where: { id: photoId, serviceId } }),
    );
    if (!photo) throw new NotFoundException();
    await reply
      .header('cache-control', 'private, max-age=86400')
      .type(photo.mime)
      .send(Buffer.from(photo.data));
  }

  @Delete('services/:id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(
    @Param('id', new ZodPipe(uuid)) serviceId: string,
    @Param('photoId', new ZodPipe(uuid)) photoId: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), (tx) =>
      tx.servicePhoto.deleteMany({ where: { id: photoId, serviceId } }),
    );
  }

  /** Soft delete: no rompe turnos ni facturas historicas (doc 08 §5). */
  @Delete('services/:id')
  @HttpCode(204)
  async removeService(
    @Param('id', new ZodPipe(uuid)) id: string,
    @Req() req: FastifyRequest & AuthRequest,
  ) {
    await this.appDb.tx(tenantCtx(req), async (tx) => {
      const existing = await tx.service.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException();
      await tx.service.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
    });
  }
}
