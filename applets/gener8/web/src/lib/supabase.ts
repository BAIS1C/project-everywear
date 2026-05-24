// @ts-nocheck
const emptyQuery = {
  select: () => emptyQuery,
  eq: () => emptyQuery,
  order: () => emptyQuery,
  limit: () => emptyQuery,
  single: async () => ({ data: null, error: null }),
  maybeSingle: async () => ({ data: null, error: null }),
  insert: async () => ({ data: null, error: null }),
  update: async () => ({ data: null, error: null }),
  delete: async () => ({ data: null, error: null }),
};

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from: () => emptyQuery,
  rpc: async () => ({ data: null, error: null }),
};
