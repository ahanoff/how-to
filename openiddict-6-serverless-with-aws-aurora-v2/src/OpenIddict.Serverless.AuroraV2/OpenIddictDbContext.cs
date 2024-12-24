using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;

namespace OpenIddict.Serverless.AuroraV2;

public class OpenIddictDbContext : DbContext
{
    private readonly IOpenIddictApplicationManager _manager;

    public OpenIddictDbContext()
    {
    }

    public OpenIddictDbContext(DbContextOptions<OpenIddictDbContext> options)
        : base(options)
    {
        
    }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        if (!optionsBuilder.IsConfigured)
        {
            optionsBuilder.UseNpgsql();
            optionsBuilder.UseOpenIddict<Guid>();
        }
    }
}