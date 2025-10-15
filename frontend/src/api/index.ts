export async function postData<TBody extends object, TResponse extends object>(
  endpoint: string,
  data: TBody
) {
  const response = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.message || `API call failed with status ${response.status}`
    );
  }
  return response.json() as Promise<TResponse>;
}

export async function patchData<TBody extends object, TResponse extends object>(
  endpoint: string,
  data: TBody
) {
  const response = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.message || `API call failed with status ${response.status}`
    );
  }
  return response.json() as Promise<TResponse>;
}

export async function putData<TBody extends object, TResponse extends object>(
  endpoint: string,
  data: TBody
) {
  const response = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.message || `API call failed with status ${response.status}`
    );
  }
  return response.json() as Promise<TResponse>;
}

export async function deleteData<TResponse extends object>(endpoint: string) {
  const response = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.message || `API call failed with status ${response.status}`
    );
  }
  return response.json() as Promise<TResponse>;
}

export async function getData<TResponse extends object>(endpoint: string) {
  const response = await fetch(`${import.meta.env.VITE_API_URL}${endpoint}`, {
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.message || `API call failed with status ${response.status}`
    );
  }
  return response.json() as Promise<TResponse>;
}
