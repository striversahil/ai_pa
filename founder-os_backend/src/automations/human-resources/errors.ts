export class HrError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HrError';
    this.status = status;
  }
}
