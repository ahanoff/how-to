FROM public.ecr.aws/lambda/dotnet:8-preview AS base

FROM mcr.microsoft.com/dotnet/sdk:8.0 as build
WORKDIR /src
COPY ["OpenIddict.Serverless.csproj", "OpenIddict.Serverless/"]
RUN dotnet restore "OpenIddict.Serverless/OpenIddict.Serverless.csproj"

WORKDIR "/src/OpenIddict.Serverless"
COPY . .
RUN dotnet build "OpenIddict.Serverless.csproj" --configuration Release --output /app/build

FROM build AS publish
RUN dotnet publish "OpenIddict.Serverless.csproj" \
            --configuration Release \ 
            --runtime linux-arm64 \
            --self-contained false \ 
            --output /app/publish \
            -p:PublishReadyToRun=true  

FROM base AS final
WORKDIR /var/task
COPY --from=publish /app/publish .
CMD ["OpenIddict.Serverless"]