<div align="center">

<h1>Advanced Example:<br>
Full-Featured Todo API with Authentication</h1>

</div>

This example demonstrates real-world usage of `@supershaneski/bun-openapi` including:

   - JWT authentication via HttpOnly cookies
   - Refresh token flow with separate path-restricted cookie
   - Double-submit CSRF protection
   - File upload (multipart/form-data)
   - Streaming responses (SSE)

## Demo Credentials

- `login: 'john'`, `password: 'test123'`
- `login: 'alice'`, `password: 'qwerty123'`

## Visualizing the API

For guidance on designing an API using OpenAPI, check the [official documentation](https://swagger.io/docs/specification/v3_0/basic-structure/).

You can then generate interactive documentation based on our [OpenAPI spec](/examples/openapi.yaml) using [Redocly](https://redocly.com/docs/cli/commands/build-docs):

```sh
npx @redocly/cli build-docs examples/openapi.yaml -o docs.html
```

## Running the Example

From the project root:
```sh
bun dev
```

Server will run on `http://localhost:3000`.

You can use a sample html client using `http://localhost:3000/app` to test.

> [!Important]
> **Cookie Security:** Browsers will only send `HttpOnly` cookies if the domain matches and `credentials: 'include'` is set. If you access the server via IP (e.g., `192.168...`) but the client is on `localhost`, the cookies will be blocked by the browser's security policy.

## Authentication Flow

The server handles security using three cookies:

1.  **accessToken:** (HttpOnly) Short-lived (15 mins).
2.  **refreshToken:** (HttpOnly) Long-lived (1 hour), restricted to `/api/refresh`.
3.  **csrfToken:** (Readable) Used to validate requests.

Since we are using cookies for auth, we need to set `credentials: include` in fetch.
Only `csrfToken` is readable by the client; auth cookies are HttpOnly and sent automatically.

### Login
The login endpoint sets the necessary cookies.

```js
const response = await fetch(`http://localhost:3000/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ 
        login: 'john', 
        password: 'test123' 
    })
})

if (!response.ok) {
    throw new Error(`Unexpected error. Status: ${response.status}`)
}

const result = await response.json()
const { name, image } = result.data

setUserName(name)
setUserImage(image) 

// Extract CSRF Token from cookie and store for refresh request
const csrfToken = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrfToken='))
    ?.split('=')[1] || null

setCsrfToken(csrfToken)
```

> [!Tip]
> Open **DevTools** → **Application** → **Cookies** to inspect the three cookies (`accessToken`, `refreshToken`, `csrfToken`).


### Refresh Token

When the `accessToken` expires, use the `refreshToken` to renew the session. 
You must manually attach the CSRF token in the headers.

```js
const response = await fetch(`http://localhost:3000/api/refresh`, {
    method: 'POST',
    headers: {
        // CSRF token is required
        ...(csrfToken ? {'x-csrf-token': csrfToken } : {})
    },
    credentials: 'include'
})

if (!response.ok) {
    throw new Error(`Unexpected error. Status: ${response.status}`)
}

// Update local CSRF token if it rotated
const newToken = document.cookie
    .split('; ')
    .find(row => row.startsWith('csrfToken='))
    ?.split('=')[1] || null

setCsrfToken(newToken)
```

If you check the browser's devtools, you can see the `refreshToken` cookie attached in the request headers.

### Logout

Clears all cookies and session data.

```js
await fetch(`http://localhost:3000/api/logout`, {
    method: 'POST',
    credentials: 'include'
})

// Clear client state
setUserName('')
setUserImage(null)
setCsrfToken(null)
```

## User Profile & File Upload

Profile updates use `multipart/form-data` to handle optional image uploads.

### File Input Handler (React Example)

```js
const handleChangeFile = (e) => {
    if(e.target.files.length === 0) return

    const file = e.target.files[0]
    setUserImageFile(file) // Store file object for upload
    setUserImage(URL.createObjectURL(file)) // Create local preview
}
```

### Uploading the Data

```js
const form = new FormData()
form.append('name', userName)

// 'image' is optional in the schema
if (userImageFile) {
    form.append('image', userImageFile) 
}

// Optional: Flag to remove existing image
// form.append('removeImage', 'true') 

const response = await fetch(`http://localhost:3000/api/profile`, {
    method: 'POST',
    credentials: 'include',
    body: form // fetch automatically sets Content-Type to multipart/form-data
})

if (!response.ok) {
    throw new Error(`Unexpected error. Status: ${response.status}`)
}

const result = await response.json()

setUserName(result.data.name)
setUserImage(result.data.image)
```

## Todo Operations (CRUD)

All Todo operations require `credentials: 'include'` to pass the `accessToken`.

### Get Todos

```js
const response = await fetch(`http://localhost:3000/api/todos?limit=10`, {
    method: 'GET',
    credentials: 'include',
})

if (!response.ok) {
    throw new Error(`Unexpected error. Status: ${response.status}`)
}

const result = await response.json()
console.log(result.data) // [{ id, title, date }, ...]
```

### Create Todo

```js
const response = await fetch(`http://localhost:3000/api/todos`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Buy dinner' })
})

if (!response.ok) {
    throw new Error(`Unexpected error. Status: ${response.status}`)
}

const result = await response.json()
```

### Delete Todo

```js
const response = await fetch(`http://localhost:3000/api/todos/${id}`, {
    method: 'DELETE',
    credentials: 'include',
})

if (!response.ok) {
    console.error(`Delete failed: ${response.status}`)
}
```

## Streaming (Server-Sent Events)

This endpoint uses an SSE-style text stream (`text/event-stream`).

Here is a complete **React JS** sample code:
```js
import { useState } from 'react'

function StreamingSample() {

    const [data, setData] = useState('')
    const [error, setError] = useState(null)
    const [loading, isLoading] = useState(false)
    
    const handleStreaming = async () => {
        try {
            const response = await fetch(`http://localhost:3000/api/stream`)

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            
            // Read stream
            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                // Raw format: "data: <chunk_content>\n\n"
                const raw = decoder.decode(value, { stream: true })
                const chunk = raw.replace(/\n/g, '').replace('data: ', '')

                // Update UI
                setData((a) => a + chunk)
            }
        } catch(err) {
            console.log(err)
        }
    }

    return (
        <div>
            <button onClick={handleStreaming}>Get Data</button>
            <p>Received: {data}</p>
        </div>
    )
}
```
---

Happy coding!

Back to main package: [../README.md](../README.md)
