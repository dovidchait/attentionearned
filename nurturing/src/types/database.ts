export interface Database {
  public: {
    Tables: {
      children: {
        Row: {
          id: string;
          name: string;
          rekognition_face_id: string | null;
          enrollment_s3_key: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          rekognition_face_id?: string | null;
          enrollment_s3_key?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          rekognition_face_id?: string | null;
          enrollment_s3_key?: string | null;
        };
      };
      parents: {
        Row: {
          id: string;
          child_id: string;
          name: string;
          email: string;
          phone: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          child_id: string;
          name: string;
          email: string;
          phone?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          child_id?: string;
          name?: string;
          email?: string;
          phone?: string | null;
        };
      };
      photos: {
        Row: {
          id: string;
          s3_key: string;
          original_filename: string | null;
          uploaded_at: string;
          processed: boolean;
        };
        Insert: {
          id?: string;
          s3_key: string;
          original_filename?: string | null;
          uploaded_at?: string;
          processed?: boolean;
        };
        Update: {
          id?: string;
          s3_key?: string;
          original_filename?: string | null;
          processed?: boolean;
        };
      };
      photo_tags: {
        Row: {
          id: string;
          photo_id: string;
          child_id: string;
          confidence: number;
          face_bounding_box: Record<string, number> | null;
          notified_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          photo_id: string;
          child_id: string;
          confidence: number;
          face_bounding_box?: Record<string, number> | null;
          notified_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          notified_at?: string | null;
        };
      };
    };
  };
}
