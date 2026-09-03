# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

# Construction Workforce App

A mobile workforce management app for construction companies.

The app is built with **Expo / React Native** and **Supabase**.

There are two user roles:

- `chef` — manages construction sites, employees, schedules, tasks, attendance, locations, instructions, and reports.
- `employee` — clocks in/out, shares location while working, sees schedules/tasks, receives instructions, reports issues, uploads photos, and marks tasks as finished.

The application is a **single mobile application** whose UI and permissions adapt based on the authenticated user's role.

---

## 1. Product Concept

The application helps construction companies manage workers on construction sites.

### Employee app

Employees should be able to:

- Clock in / clock out
- Share their location while on shift
- See today's schedule
- See assigned construction site
- See assigned zone
- See assigned tasks
- Receive instructions from the chef de chantier
- Report an issue
- Take/upload photos
- Mark a task as finished

### Chef de chantier app

Chefs should be able to:

- Create a construction site
- Define zones on a map
- Create employees / teams
- Build weekly and daily schedules
- Assign employees to sites
- Assign employees to zones
- Assign tasks
- See employees currently on site
- See who is late / absent
- See historical presence
- Send instructions
- View reported issues
- View uploaded photos

---

# 2. User Roles

There are only **two permanent roles**:

```text
employee
chef
```

There is intentionally no `admin` or `owner` role in the current product model.

The first person creating a company becomes a `chef`.

A chef can create/invite employees belonging to their company.

Employees do **not** choose their company during login.

The company is determined by their database profile.

The authentication flow is:

```text
                    Login
                      |
                      v
                Supabase Auth
                      |
                      v
                   Profile
                      |
             +--------+--------+
             |                 |
          employee           chef
             |                 |
      Employee UI          Chef UI
```

---

# 3. Onboarding

### Company creator

The first person creating a company follows:

```text
Create account
      |
      v
Create company
      |
      v
User becomes chef
      |
      v
Chef dashboard
```

### Employee

Employees are created/invited by a chef.

They do not create their own company.

The employee login flow is:

```text
Login
  |
  v
Supabase Auth
  |
  v
profiles
  |
  +-- company_id
  |
  +-- role = employee
  |
  v
Employee UI
```

---

# 4. Technology Stack

## Mobile

- Expo
- React Native
- TypeScript

## Backend

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Storage
- Supabase Realtime
- PostGIS

## Development

- Supabase CLI
- Docker
- Colima on macOS
- Git
- GitHub

---

# 5. Architecture

High-level architecture:

```text
                    Expo App
                       |
                       |
                Supabase Client
                       |
        +--------------+--------------+
        |              |              |
        v              v              v
      Auth          Database        Storage
                       |
                   PostgreSQL
                       |
                    PostGIS
```

The mobile application is a single app.

The user's role determines which screens and capabilities are available.

```text
                         App
                          |
                        Login
                          |
                       Profile
                          |
                +---------+---------+
                |                   |
             employee             chef
                |                   |
          Employee UI          Chef UI
```

---

# 6. Database

The database is PostgreSQL hosted by Supabase.

PostGIS is enabled because location tracking is a core feature.

Current initial tables:

```text
companies
profiles
sites
zones
shifts
location_events
```

Relationship model:

```text
                    companies
                        |
             +----------+----------+
             |                     |
             v                     v
         profiles                sites
             |                     |
             |                     v
             |                   zones
             |
             v
           shifts

profiles
    |
    v
location_events
```

---

# 7. Database Tables

## companies

Represents a construction company.

```text
companies
- id
- name
- created_at
- updated_at
```

A company can have multiple chefs and employees.

---

## profiles

Application-specific information for an authenticated user.

Supabase Auth owns the authentication identity in `auth.users`.

`profiles.id` references `auth.users.id`.

```text
profiles
- id
- company_id
- first_name
- last_name
- role
- phone
- created_at
- updated_at
```

Allowed roles:

```text
employee
chef
```

The role must be enforced by a PostgreSQL CHECK constraint.

A profile belongs to exactly one company in V1.

---

## sites

Represents a construction site.

```text
sites
- id
- company_id
- name
- address
- location
- geofence_radius_meters
- created_at
- updated_at
```

`location` uses PostGIS:

```text
extensions.geography(Point, 4326)
```

The `geofence_radius_meters` value determines how close an employee must be to the site to be considered on site.

Default:

```text
100 meters
```

---

## zones

A construction site can contain multiple zones.

Examples:

```text
Ground floor
First floor
Zone A
Zone B
Storage
```

```text
zones
- id
- site_id
- name
- created_at
- updated_at
```

Zone names should be unique within a site.

---

## shifts

Represents an employee's scheduled work period.

```text
shifts
- id
- employee_id
- site_id
- zone_id
- starts_at
- ends_at
- created_at
- updated_at
```

Example:

```text
Employee: Jean
Day: Monday
Time: 08:00 -> 17:00
Site: École Victor Hugo
Zone: Ground Floor
```

`ends_at` must be after `starts_at`.

---

## location_events

Stores employee location events.

```text
location_events
- id
- employee_id
- site_id
- recorded_at
- location
- accuracy_meters
- event_type
```

`location` uses PostGIS:

```text
extensions.geography(Point, 4326)
```

Allowed event types:

```text
location_update
enter_site
exit_site
```

GPS coordinates must use:

```text
longitude, latitude
```

not:

```text
latitude, longitude
```

Spatial GIST indexes should be used for geographic queries.

---

# 8. Database Security

The database is the source of truth.

Do **not** rely only on the React Native application to enforce business rules.

Important rules must be enforced at the PostgreSQL/RLS level.

Examples:

- A profile must belong to a company.
- A profile role must be `employee` or `chef`.
- A shift must have `ends_at > starts_at`.
- A site must have a valid geographic location.
- Employees must not be able to change their own `company_id`.
- Employees must not be able to change their own `role`.
- Users must not be able to access another company's data.

---

# 9. Row Level Security

RLS is a required part of the security architecture.

**The application must not be considered production-ready until RLS is implemented and tested.**

## Employee permissions

An employee should be able to:

- Read their own profile
- Read their own shifts
- Read their assigned tasks
- Create/update their own location events where appropriate
- Read relevant site/zone information
- Read instructions assigned to them
- Create issue reports
- Upload relevant photos
- Mark assigned tasks as finished

An employee must NOT be able to:

- Access another company's data
- Access another employee's private data
- Change their company
- Change their role
- Modify another employee's schedule
- Modify another employee's location data

## Chef permissions

A chef should be able to access data belonging to their company:

- Employees
- Sites
- Zones
- Shifts
- Tasks
- Attendance
- Location data
- Instructions
- Issues
- Photos

A chef must NOT be able to access another company's data.

---

# 10. Location Tracking

Location tracking is a core feature.

Intended behavior:

```text
Employee
   |
   | Clock in
   v
Shift starts
   |
   v
Location sharing enabled
   |
   v
Periodic GPS updates
   |
   v
location_events
   |
   v
Chef dashboard
```

When the employee clocks out:

```text
Clock out
   |
   v
Stop location sharing
```

The exact GPS frequency has **not yet been finalized**.

Do not implement extremely frequent GPS polling without considering:

- Battery consumption
- iOS background location limitations
- Android background location limitations
- GPS accuracy
- Network availability
- Privacy requirements
- Storage volume
- Database scaling
- Cost

Location tracking should only occur during an active work shift unless product requirements explicitly change.

---

# 11. Geofencing

Sites have:

```text
location
geofence_radius_meters
```

Example:

```text
             Construction Site
                    |
                    v
              +-----------+
              |           |
              |   100m    |
              |   radius  |
              |           |
              +-----------+
                    |
              Employee GPS
```

The backend should use PostGIS geographic functions to determine whether an employee is inside the site geofence.

Do not implement geographic distance calculations independently in multiple parts of the application.

Prefer PostGIS.

---

# 12. Database Migrations

The SQL migrations are the **source of truth** for the database schema.

Do NOT manually create production tables through the Supabase dashboard.

Schema changes must be made through migrations.

Create a migration:

```bash
npx supabase migration new add_employee_job_title
```

Edit the generated SQL file.

Test locally:

```bash
npx supabase db reset
```

Commit:

```bash
git add .
git commit -m "Add employee job title"
git push
```

Deploy:

```bash
npx supabase db push
```

## Important

Never modify an already-deployed migration.

If the database needs to change, create a new migration.

Example:

```text
supabase/migrations/
├── 20260822123449_initial_schema.sql
└── 20260822150000_add_employee_job_title.sql
```

---

# 13. Local Supabase

Local Supabase runs through Docker/Colima.

Start:

```bash
npx supabase start
```

Reset local database:

```bash
npx supabase db reset
```

This rebuilds the local database from the migration files.

Local Supabase Studio:

```text
http://127.0.0.1:54323
```

Local API:

```text
http://127.0.0.1:54321
```

Local PostgreSQL:

```text
postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

Local development is for testing only.

Do not use local development credentials in production.

---

# 14. Remote Supabase

Remote Supabase project:

```text
Project ref:
knjtwwkoaofaqyhopytg
```

Link the local project:

```bash
npx supabase link --project-ref knjtwwkoaofaqyhopytg
```

Deploy migrations:

```bash
npx supabase db push
```

The remote Supabase project contains the real cloud database.

Always verify the linked project before pushing migrations.

---

# 15. Development Workflow

Start development:

```bash
git pull
npx supabase start
```

Create a database migration:

```bash
npx supabase migration new <migration_name>
```

Test it:

```bash
npx supabase db reset
```

If successful:

```bash
git add .
git commit -m "Description"
git push
```

When deploying the migration:

```bash
npx supabase db push
```

---

# 16. Git and Secrets

Never commit:

```text
.env
.env.local
production secrets
Supabase secret keys
service role keys
private API keys
```

The Expo application must **never** contain a Supabase service-role/secret key.

The mobile application should only use the public/publishable Supabase client credentials.

Privileged keys must remain server-side.

---

# 17. TypeScript Database Types

The application should use generated Supabase TypeScript types rather than manually duplicating database table definitions.

Desired architecture:

```text
PostgreSQL schema
       |
       v
Supabase generated types
       |
       v
TypeScript / Expo
```

Avoid creating competing manually-maintained TypeScript database types when generated types are available.

---

# 18. Application Architecture

Prefer:

```text
UI
 |
 v
Hooks / application logic
 |
 v
Supabase client
 |
 v
PostgreSQL / Supabase
```

Avoid putting large amounts of database/business logic directly inside UI components.

Keep business logic reusable.

Possible organization:

```text
lib/
├── supabase.ts
├── auth/
├── locations/
├── schedules/
├── sites/
└── employees/
```

The exact organization can evolve.

---

# 19. One Mobile Application

There should be **one Expo application**.

Do not create separate employee and chef mobile applications unless there is a strong technical reason later.

The user's role determines the UI:

```text
                         App
                          |
                        Login
                          |
                       Profile
                          |
                +---------+---------+
                |                   |
             employee             chef
                |                   |
          Employee UI          Chef UI
```

---

# 20. Current Database Status

The initial database migration has been created.

The migration has been successfully tested locally.

Current tables:

```text
companies
profiles
sites
zones
shifts
location_events
```

PostGIS is enabled.

Local Supabase is working.

The remote deployment should always be verified with:

```bash
npx supabase migration list
```

before assuming the latest migrations are deployed.

RLS is the next major database/security task.

---

# 21. Development Priorities

Recommended implementation order:

1. Authentication
2. Profile loading
3. Employee/chef role-based navigation
4. RLS
5. Company creation/onboarding
6. Employee creation/invitations
7. Construction sites
8. Map + zones
9. Employee schedules
10. Clock in/out
11. Location tracking
12. Chef live employee map
13. Attendance / late / absent logic
14. Tasks
15. Instructions
16. Issues
17. Photos
18. Task completion

Do not implement everything at once.

Build and test each layer before adding the next.

---

# 22. AI Coding Agent Instructions

This repository is actively developed with AI coding agents such as **Codex and Claude**.

Before modifying anything:

1. Read this README.
2. Inspect the existing implementation.
3. Do not assume a feature has not already been implemented.
4. Preserve the existing architecture unless there is a strong reason to change it.
5. Do not introduce unnecessary dependencies.
6. Do not modify production database data directly.
7. Database schema changes must use Supabase migrations.
8. Never expose Supabase secret/service-role credentials to the Expo client.
9. Do not weaken RLS or authentication rules to make a feature work.
10. Do not silently change the employee/chef product model.
11. Do not create a third permanent role without discussing the architectural implications.
12. Prefer small, testable changes.
13. Run relevant tests/type checks after modifications.
14. Keep this README updated when major architectural decisions change.
15. Before adding a new database table, check whether the existing schema already models the required concept.
16. Before adding a dependency, check whether the functionality can be implemented using the existing stack.
17. Never hardcode secrets, API keys, passwords, or Supabase service-role credentials.
18. When changing database schema, create a migration rather than editing existing deployed migrations.
19. Consider RLS implications for every new table.
20. Consider multi-company isolation for every database query and policy.

---

# 23. Product Principles

The goal is to build a simple, reliable workforce management tool for construction companies.

The employee experience should be extremely simple.

The chef experience should provide powerful management capabilities without unnecessary complexity.

Prioritize:

- Reliability
- Simple UX
- Accurate attendance
- Useful location information
- Low battery consumption
- Strong privacy/security
- Clear permissions
- Multi-company data isolation
- Scalable database design

Avoid unnecessary complexity until the core workflow works.