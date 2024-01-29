FROM public.ecr.aws/lambda/dotnet:8-preview AS base

FROM mcr.microsoft.com/dotnet/sdk:8.0 as build
WORKDIR /src
COPY ["AspNet8ContainerImage.csproj", "AspNet8ContainerImage/"]
RUN dotnet restore "AspNet8ContainerImage/AspNet8ContainerImage.csproj"

WORKDIR "/src/AspNet8ContainerImage"
COPY . .
RUN dotnet build "AspNet8ContainerImage.csproj" --configuration Release --output /app/build

FROM build AS publish
RUN dotnet publish "AspNet8ContainerImage.csproj" \
    --configuration Release \
    --runtime linux-x64 \
    --self-contained false \
    --output /app/publish \
    -p:PublishReadyToRun=true  

FROM base AS final
WORKDIR /var/task
COPY --from=publish /app/publish .
CMD ["AspNet8ContainerImage"]
