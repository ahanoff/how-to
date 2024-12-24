using Microsoft.AspNetCore.Mvc;
using OpenIddict.Abstractions;

namespace OpenIddict.Serverless.AuroraV2.Controllers;

public class DbController
{
    private readonly IOpenIddictApplicationManager _applicationManager;
    private readonly OpenIddictDbContext _dbContext;

    public DbController(IOpenIddictApplicationManager applicationManager, OpenIddictDbContext dbContext)
    {
        _applicationManager = applicationManager;
        _dbContext = dbContext;
    }

    /// <summary>
    /// For demo purpose only
    /// This API needs to be called before trying to obtain access token with OAuth2 flows
    /// It ensures that database is created, db migrations are applied, and seeds demo client
    /// </summary>
    /// <param name="ct"></param>
    /// <returns></returns>
    [HttpPost("/seed-database"), Produces("application/json")]
    public async Task<IActionResult> SeedDatabaseAsync(CancellationToken ct)
    {
        await _dbContext.Database.EnsureCreatedAsync(ct);
        if (await _applicationManager.FindByClientIdAsync("serverless-demo", ct) is null)
        {
            await _applicationManager.CreateAsync(new OpenIddictApplicationDescriptor
            {
                ClientId = "serverless-demo",
                ClientSecret = "serverless-demo-secret",
                Permissions =
                {
                    OpenIddictConstants.Permissions.Endpoints.Token,
                    OpenIddictConstants.Permissions.GrantTypes.ClientCredentials
                }
                
            }, ct);
        }
        return new CreatedResult("/seed-database", new { clientId = "serverless-demo" });
    }
}
