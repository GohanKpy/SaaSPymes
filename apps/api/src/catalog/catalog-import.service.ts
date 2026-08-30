import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { TenantContext } from '@pymes/db';
import { DEFAULT_MAX_IMPORT_ROWS, type CatalogImport } from '@pymes/shared';

import { AppPrisma } from '../prisma/app-prisma.service';

// Carga masiva del catalogo por CSV (pedido 2026-08-30).
// Flujo: el cliente crea sus categorias en el sistema → descarga la plantilla
// (generada con SUS categorias, con una fila de ejemplo por cada una) → la
// completa en Excel → la sube. El server parsea y valida TODO; con dry_run
// devuelve la vista previa (que se crearia + errores por fila) sin escribir,
// y sin dry_run crea todo-o-nada: un solo error y no se importa nada.

const COLUMNAS = [
  'categoria',
  'nombre',
  'tipo',
  'precio',
  'duracion_min',
  'requiere_reunion',
  'reunion_min',
  'iva',
  'descripcion',
] as const;
type Columna = (typeof COLUMNAS)[number];

interface FilaValida {
  linea: number;
  categoryId: string;
  categoria: string;
  nombre: string;
  tipo: 'servicio' | 'item';
  precio: bigint;
  duracionMin: number | null;
  requiereReunion: boolean;
  reunionMin: number | null;
  iva: 0 | 5 | 10;
  descripcion: string | null;
}

export interface ImportReport {
  ok: boolean;
  total_filas: number;
  a_crear: {
    linea: number;
    categoria: string;
    nombre: string;
    tipo: string;
    precio: string;
    detalle: string;
  }[];
  errores: { linea: number; error: string }[];
  creados: number;
}

/** minusculas sin acentos, para comparar nombres/encabezados con tolerancia */
function clave(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Parser CSV (RFC 4180): comillas, separador ; o , autodetectado. */
export function parseCsv(texto: string): string[][] {
  const sinBom = texto.replace(/^\uFEFF/, '');
  const primeraLinea = sinBom.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeraLinea.match(/;/g)?.length ?? 0) >= (primeraLinea.match(/,/g)?.length ?? 0) ? ';' : ',';

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;
  for (let i = 0; i < sinBom.length; i++) {
    const c = sinBom[i];
    if (enComillas) {
      if (c === '"') {
        if (sinBom[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
    } else if (c === '"') {
      enComillas = true;
    } else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && sinBom[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else {
      campo += c;
    }
  }
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

@Injectable()
export class CatalogImportService {
  constructor(private readonly appDb: AppPrisma) {}

  /** Plantilla generada con las categorias reales del tenant (una fila de
   *  ejemplo por categoria; el import ignora las filas EJEMPLO). */
  async template(ctx: TenantContext): Promise<{ csv: string; filename: string }> {
    const categorias = await this.appDb.tx(ctx, (tx) =>
      tx.serviceCategory.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } }),
    );
    if (categorias.length === 0) {
      throw new UnprocessableEntityException({
        type: 'https://docs.pymes.local/errors/no-categories',
        title: 'Crea primero tus categorias en el catalogo: la plantilla se arma con ellas',
      });
    }
    const esc = (v: string) => (/[";,\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const lineas = [COLUMNAS.join(';')];
    for (const cat of categorias) {
      if (cat.defaultKind === 'item') {
        lineas.push(
          [esc(cat.name), 'EJEMPLO (borra esta fila): Shampoo 500ml', 'item', '80000', '', 'no', '', '10', 'Producto de venta directa'].join(';'),
        );
      } else {
        lineas.push(
          [esc(cat.name), 'EJEMPLO (borra esta fila): Corte de dama', 'servicio', '150000', '45', '', '', '10', 'Corte y peinado'].join(';'),
        );
      }
    }
    // BOM: Excel abre UTF-8 con acentos bien.
    return { csv: '\uFEFF' + lineas.join('\r\n') + '\r\n', filename: 'plantilla-catalogo.csv' };
  }

  async import(ctx: TenantContext, dto: CatalogImport): Promise<ImportReport> {
    const filas = parseCsv(dto.csv);
    if (filas.length < 2) {
      throw new UnprocessableEntityException({ title: 'El archivo esta vacio: completa la plantilla y volvela a subir' });
    }

    // Encabezado: columnas por nombre (tolerante a acentos/mayusculas/orden).
    const header = (filas[0] ?? []).map(clave);
    const idx = {} as Record<Columna, number>;
    for (const col of COLUMNAS) idx[col] = header.indexOf(col);
    for (const obligatoria of ['categoria', 'nombre', 'precio'] as const) {
      if (idx[obligatoria] === -1) {
        throw new UnprocessableEntityException({
          title: `El archivo no tiene la columna '${obligatoria}': usa la plantilla descargada del sistema`,
        });
      }
    }

    const { categorias, existentes } = await this.appDb.tx(ctx, async (tx) => ({
      categorias: await tx.serviceCategory.findMany({ where: { deletedAt: null } }),
      existentes: await tx.service.findMany({ where: { deletedAt: null }, select: { name: true } }),
    }));
    const porNombreCat = new Map(categorias.map((c) => [clave(c.name), c]));
    const nombresUsados = new Set(existentes.map((s) => clave(s.name)));

    const validas: FilaValida[] = [];
    const errores: { linea: number; error: string }[] = [];
    const cuerpo = filas.slice(1);
    let procesadas = 0;

    for (let f = 0; f < cuerpo.length; f++) {
      const linea = f + 2; // 1-based + encabezado
      const celdas = cuerpo[f] ?? [];
      const val = (col: Columna) => (idx[col] === -1 ? '' : (celdas[idx[col]] ?? '').trim());

      if (celdas.every((c) => c.trim() === '')) continue; // fila vacia
      const nombre = val('nombre');
      if (clave(nombre).startsWith('ejemplo')) continue; // fila de muestra de la plantilla
      procesadas++;
      if (procesadas > DEFAULT_MAX_IMPORT_ROWS) {
        errores.push({ linea, error: `maximo ${DEFAULT_MAX_IMPORT_ROWS} productos por archivo: parti la lista en dos` });
        break;
      }

      const err = (m: string) => errores.push({ linea, error: m });

      if (!nombre) {
        err('falta el nombre del producto');
        continue;
      }
      if (nombre.length > 200) {
        err('el nombre supera los 200 caracteres');
        continue;
      }
      const cat = porNombreCat.get(clave(val('categoria')));
      if (!cat) {
        err(`la categoria '${val('categoria') || '(vacia)'}' no existe en tu catalogo: creala primero en el sistema y descarga la plantilla de nuevo`);
        continue;
      }
      if (nombresUsados.has(clave(nombre))) {
        err(`ya existe un producto llamado '${nombre}' (en el catalogo o repetido en este archivo)`);
        continue;
      }

      const tipoRaw = clave(val('tipo'));
      const tipo = tipoRaw === '' ? (cat.defaultKind as 'servicio' | 'item') : tipoRaw === 'servicio' ? 'servicio' : tipoRaw === 'item' ? 'item' : null;
      if (!tipo) {
        err(`tipo '${val('tipo')}' invalido: usa 'servicio', 'item' o dejalo vacio (toma el de la categoria)`);
        continue;
      }

      const precioLimpio = val('precio').replace(/[.\s]/g, '').replace(/gs\.?$/i, '');
      if (!/^\d+$/.test(precioLimpio)) {
        err(`precio '${val('precio')}' invalido: solo numeros en guaranies, sin decimales (ej. 150000 o 150.000)`);
        continue;
      }
      const precio = BigInt(precioLimpio);

      const ivaRaw = val('iva');
      const iva = ivaRaw === '' ? 10 : Number(ivaRaw);
      if (![0, 5, 10].includes(iva)) {
        err(`iva '${ivaRaw}' invalido: 0, 5 o 10 (vacio = 10)`);
        continue;
      }

      const minutos = (col: Columna): number | null | false => {
        const v = val(col);
        if (v === '') return null;
        const n = Number(v);
        return Number.isInteger(n) && n > 0 && n <= 1440 ? n : false;
      };
      const duracionMin = minutos('duracion_min');
      if (duracionMin === false) {
        err(`duracion_min '${val('duracion_min')}' invalida: minutos enteros (ej. 45) o vacio`);
        continue;
      }
      const reunionMin = minutos('reunion_min');
      if (reunionMin === false) {
        err(`reunion_min '${val('reunion_min')}' invalida: minutos enteros o vacio`);
        continue;
      }

      const reunionRaw = clave(val('requiere_reunion'));
      let requiereReunion: boolean | null =
        reunionRaw === '' ? true : ['si', 's', 'x', 'true', '1', 'yes'].includes(reunionRaw) ? true : ['no', 'n', 'false', '0'].includes(reunionRaw) ? false : null;
      if (requiereReunion === null) {
        err(`requiere_reunion '${val('requiere_reunion')}' invalido: 'si', 'no' o vacio`);
        continue;
      }
      if (tipo === 'servicio') requiereReunion = false;

      nombresUsados.add(clave(nombre)); // duplicados dentro del mismo archivo
      validas.push({
        linea,
        categoryId: cat.id,
        categoria: cat.name,
        nombre,
        tipo,
        precio,
        duracionMin: tipo === 'servicio' ? duracionMin : null,
        requiereReunion,
        reunionMin: tipo === 'item' && requiereReunion ? reunionMin : null,
        iva: iva as 0 | 5 | 10,
        descripcion: val('descripcion') || null,
      });
    }

    const report: ImportReport = {
      ok: errores.length === 0 && validas.length > 0,
      total_filas: procesadas,
      a_crear: validas.map((v) => ({
        linea: v.linea,
        categoria: v.categoria,
        nombre: v.nombre,
        tipo: v.tipo,
        precio: v.precio.toString(),
        detalle:
          v.tipo === 'servicio'
            ? `tarea de ${v.duracionMin ?? 30} min`
            : v.requiereReunion
              ? `reunion inicial de ${v.reunionMin ?? 30} min`
              : 'venta directa',
      })),
      errores,
      creados: 0,
    };
    if (procesadas === 0 && errores.length === 0) {
      errores.push({ linea: 0, error: 'el archivo solo tiene las filas de ejemplo: completa tus productos' });
      report.ok = false;
    }
    if (dto.dry_run || !report.ok) return report;

    // Todo-o-nada dentro de una transaccion: o entra la lista completa o nada.
    await this.appDb.tx(ctx, async (tx) => {
      for (const v of validas) {
        await tx.service.create({
          data: {
            tenantId: ctx.tenantId,
            categoryId: v.categoryId,
            name: v.nombre,
            description: v.descripcion,
            price: v.precio,
            taxRate: v.iva,
            kind: v.tipo,
            durationMin: v.duracionMin,
            requiresMeeting: v.requiereReunion,
            meetingMin: v.reunionMin,
          },
        });
      }
    });
    report.creados = validas.length;
    return report;
  }
}
