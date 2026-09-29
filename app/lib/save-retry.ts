export const shouldRetryFailedStateSave = (status: number) => (
  [408, 409, 425, 429].includes(status) || status >= 500
);
