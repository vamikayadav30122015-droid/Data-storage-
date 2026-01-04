
export enum Department {
  CARDIOLOGY = 'Cardiology',
  NEUROLOGY = 'Neurology',
  PEDIATRICS = 'Pediatrics',
  GENERAL_OPD = 'General OPD',
  ORTHOPEDICS = 'Orthopedics',
  EMERGENCY = 'Emergency'
}

export interface MedicalRecord {
  id: string;
  patientName: string;
  patientAge: number;
  department: Department;
  observations: string;
  timestamp: number;
  status: 'pending' | 'uploaded';
  bonusEarned: number;
}

export interface UserStats {
  totalUploads: number;
  totalBonus: number;
  efficiencyScore: number;
}
