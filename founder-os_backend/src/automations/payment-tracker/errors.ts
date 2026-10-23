/** Domain error carrying the HTTP status the route should return. */
export class PaymentTrackerError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
