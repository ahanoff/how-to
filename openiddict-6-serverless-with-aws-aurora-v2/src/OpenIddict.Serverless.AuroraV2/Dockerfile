FROM --platform=$BUILDPLATFORM public.ecr.aws/lambda/dotnet:8 AS base

FROM --platform=$BUILDPLATFORM mcr.microsoft.com/dotnet/sdk:8.0 as build
ARG TARGETARCH
WORKDIR /src
COPY ["OpenIddict.Serverless.AuroraV2.csproj", "./"]
RUN dotnet restore --arch $TARGETARCH "OpenIddict.Serverless.AuroraV2.csproj"

WORKDIR "/src/OpenIddict.Serverless.AuroraV2"
COPY . .
RUN dotnet build --arch $TARGETARCH "OpenIddict.Serverless.AuroraV2.csproj" --configuration Release --output /app/build

FROM build AS publish
RUN dotnet publish "OpenIddict.Serverless.AuroraV2.csproj" \
    --configuration Release \
    --arch $TARGETARCH \
    --output /app/publish \
    -p:PublishReadyToRun=true  

FROM base AS final
WORKDIR /var/task
COPY --from=publish /app/publish .
CMD ["OpenIddict.Serverless.AuroraV2"]