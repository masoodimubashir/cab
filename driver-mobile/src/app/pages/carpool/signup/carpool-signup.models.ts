/** Driver-app-only types for the carpool sign-up (M1). */

export type DriverTypeChoice = 'commercial' | 'carpool';

export interface CarpoolVehicle {
  id: number;
  make: string;
  model: string;
  colour: string;
  plate: string;
  seats: number;
  front_photo_url: string | null;
  interior_photo_url: string | null;
}

export interface DocumentSlot {
  index: number;
  status: 'missing' | 'uploaded' | 'pending' | 'approved' | 'rejected';
  rejection_reason: string | null;
}

export interface DocumentRequirement {
  document_id: number | null;
  name: string;
  required: string;
  required_images: number;
  uploaded_images: number;
  approved_images: number;
  status: 'missing' | 'pending' | 'approved' | 'rejected';
  slots: DocumentSlot[];
}

export interface CatalogDocument {
  id: number;
  name: string;
  no_of_images: number;
  instructions: string | null;
  labels: { label: string; label_type: 'text' | 'number' | 'date' | 'url'; mandatory: boolean }[];
}

/** The parts of GET /drivers/me the carpool pages read. */
export interface DriverMe {
  user: { id: number; name: string; phone: string | null; avatar_url: string | null };
  driver: {
    id: number;
    driver_type?: DriverTypeChoice;
    approval_status: 'pending' | 'approved' | 'rejected';
    city_id: number | null;
    carpool_vehicle?: CarpoolVehicle | null;
  } | null;
  document_requirements: DocumentRequirement[];
}

/**
 * Remembers that this person chose "Commercial driver" on the first sign-up
 * question, so the commercial wizard isn't interrupted by the question again.
 */
export class DriverTypeMemory {
  private static key(userId: number): string {
    return `dc_driver_type_choice_${userId}`;
  }

  static get(userId: number | undefined): DriverTypeChoice | null {
    if (!userId) return null;
    try {
      const v = localStorage.getItem(DriverTypeMemory.key(userId));
      return v === 'commercial' || v === 'carpool' ? v : null;
    } catch {
      return null;
    }
  }

  static set(userId: number | undefined, choice: DriverTypeChoice): void {
    if (!userId) return;
    try {
      localStorage.setItem(DriverTypeMemory.key(userId), choice);
    } catch {
      /* private mode: the question is simply asked again */
    }
  }
}
