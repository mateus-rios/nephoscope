import type { KitItem } from '@nephoscope/contracts';
import type { ComponentType } from 'react';
import { SqlFlags } from '../cloudsql/SqlFlags';
import { SerialOutput } from '../compute/SerialOutput';

export interface KitTabProps {
  projectId: string;
  collectionKey: string;
  path: string;
  item: KitItem;
  readOnly: string | null;
}

/** Components of the kit's custom tabs (KitCollection.customTabs), by id. */
export const kitTabs: Record<string, ComponentType<KitTabProps>> = {
  serial: SerialOutput,
  sqlflags: SqlFlags,
};
