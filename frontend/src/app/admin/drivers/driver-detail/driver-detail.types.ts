export interface DriverProfile {
  id: number;
  user_id: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_path?: string | null;
  avatar_url?: string | null;
  ride_type_id: number | null;
  ride_type_name: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  city_vehicle_type_id: number | null;
  city_vehicle_type_name: string | null;
  vehicle_reg_no: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  approval_status: 'pending' | 'approved' | 'rejected';
  deactivated_at: string | null;
  is_online: boolean;
  created_at: string | null;
}

export interface DocLabelMeta {
  label: string;
  label_type: 'text' | 'number' | 'date' | 'url';
  mandatory: boolean;
}

export interface DriverDocumentRow {
  id: number;
  document_id: number | null;
  document_name: string | null;
  document_type: string | null;
  vehicle_type_id: number | null;
  vehicle_type_name: string | null;
  file_path: string;
  file_url: string;
  image_index: number | null;
  label_values: Record<string, string> | null;
  labels_meta: DocLabelMeta[];
  status: 'uploaded' | 'approved' | 'rejected';
  rejection_reason: string | null;
  uploaded_at: string | null;
}

export interface CatalogDoc {
  id: number;
  name: string;
  no_of_images: number;
}

export interface VehicleForm {
  vehicle_reg_no: string;
}
