# syntax=docker/dockerfile:1

# 1. Angular frontend
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2. .NET API
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/LogHub.Api/LogHub.Api.csproj src/LogHub.Api/
COPY src/LogHub.Db/LogHub.Db.csproj src/LogHub.Db/
RUN dotnet restore src/LogHub.Api/LogHub.Api.csproj
COPY src/ src/
RUN dotnet publish src/LogHub.Api/LogHub.Api.csproj -c Release -o /app --no-restore

# 3. Runtime image: the API serves the Angular build from wwwroot
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /web/dist/loghub/browser ./wwwroot
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "LogHub.Api.dll"]
